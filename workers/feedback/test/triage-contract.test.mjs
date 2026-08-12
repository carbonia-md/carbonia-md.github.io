/**
 * LB-71 contract tests for the framework-owned feedback triage skill.
 *
 * The skill is an operational interface: these tests inspect only its published
 * instructions and migration. They deliberately do not import worker or skill
 * implementation code.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SKILL_URL = new URL(
  '../../../.agents/skills/sekai-triage-feedback/SKILL.md',
  import.meta.url,
);
const MIGRATION_URL = new URL('../migrations/0002_triage.sql', import.meta.url);

const CLASSES = ['addition', 'broken-link', 'correction', 'praise-other', 'spam'];

function readContract(url, label) {
  try {
    return readFileSync(url, 'utf8');
  } catch (error) {
    assert.fail(`${label} must exist and be readable: ${error.message}`);
  }
}

function skillSource() {
  return readContract(SKILL_URL, 'sekai-triage-feedback/SKILL.md');
}

function frontmatter(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  assert.ok(match, 'SKILL.md must start with YAML frontmatter');
  return match[1];
}

function scalarField(yaml, field) {
  const match = yaml.match(new RegExp(`^${field}:\\s*([^\\n]+)\\s*$`, 'm'));
  assert.ok(match, `frontmatter must declare ${field}`);
  return match[1].trim();
}

function blockField(yaml, field) {
  const lines = yaml.split('\n');
  const start = lines.findIndex((line) => new RegExp(`^${field}:\\s*[>|][+-]?\\s*$`).test(line));
  assert.notEqual(start, -1, `${field} must be a multiline YAML block`);

  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (line.length > 0 && !/^\s/.test(line)) break;
    body.push(line.replace(/^ {2}/, ''));
  }
  return body.join('\n').trim();
}

function markdownSection(source, headingName) {
  const headings = [...source.matchAll(/^(#{1,6})\s+(.+?)\s*$/gm)];
  const heading = headings.find((candidate) => headingName.test(candidate[2]));
  assert.ok(heading, `SKILL.md must have a ${headingName} section`);

  const level = heading[1].length;
  const next = headings.find(
    (candidate) => candidate.index > heading.index && candidate[1].length <= level,
  );
  return source.slice(heading.index + heading[0].length, next?.index ?? source.length);
}

function shellBlocks(source) {
  return [...source.matchAll(/```(?:bash|sh|shell)\s*\n([\s\S]*?)```/gi)].map((match) =>
    match[1]
      .replace(/\\\r?\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function codeBlocks(source, language) {
  return [...source.matchAll(new RegExp(`\`\`\`${language}\\s*\\n([\\s\\S]*?)\`\`\``, 'gi'))].map(
    (match) => match[1].replace(/\s+/g, ' ').trim(),
  );
}

function assertWranglerExecute(command, purpose) {
  assert.match(
    command,
    /\bnpx\s+wrangler\s+d1\s+execute\s+\S+\b/i,
    `${purpose} must use npx wrangler d1 execute <database> --remote --command`,
  );
  assert.match(command, /\s--remote\b/i, `${purpose} must target the remote D1 database`);
  assert.match(command, /\s--command\b/i, `${purpose} must pass SQL through --command`);
}

test('0002_triage adds one nullable TEXT issue_url column to feedback', () => {
  const migration = readContract(MIGRATION_URL, 'workers/feedback/migrations/0002_triage.sql');
  const statements = migration
    .replace(/--.*$/gm, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);

  assert.equal(statements.length, 1, 'the migration must contain one schema change');
  assert.match(
    statements[0],
    /^ALTER\s+TABLE\s+(?:feedback|["`]feedback["`]|\[feedback\])\s+ADD(?:\s+COLUMN)?\s+(?:issue_url|["`]issue_url["`]|\[issue_url\])\s+TEXT$/i,
  );
  assert.doesNotMatch(
    statements[0],
    /\bNOT\s+NULL\b/i,
    'issue_url must remain nullable because spam stores NULL',
  );
});

test('skill metadata uses the framework contract and remains place-free ASCII', () => {
  const source = skillSource();
  const yaml = frontmatter(source);

  assert.equal(scalarField(yaml, 'name'), 'sekai-triage-feedback');
  const description = blockField(yaml, 'description');
  assert.match(
    description,
    /(?:^|\n)TRIGGER when:[\s\S]*$/,
    'the description must end with a TRIGGER when clause',
  );
  assert.match(yaml, /^allowed-tools:\s*(?:\S.*)?$/m, 'frontmatter must declare allowed-tools');
  assert.ok(
    /^[\x00-\x7f]*$/.test(source),
    'framework skill instructions must contain ASCII only',
  );
});

test('skill documents dry-run, approved-write mode, and optional database arguments with config fallback', () => {
  const source = skillSource();
  const argumentsSection = markdownSection(source, /arguments|usage|invocation/i);

  assert.match(argumentsSection, /\bdry-run\b/i);
  assert.match(argumentsSection, /\bdatabase(?:[- ]name)?\b/i);
  assert.match(argumentsSection, /\boptional\b|\bif omitted\b|\bdefault\b/i);
  // The fallback resolves through the GENERATED config, never the committed
  // template: the latter carries framework placeholders only (LB-77), so a skill
  // that read it would resolve to no database at all.
  assert.match(source, /workers\/feedback\/wrangler\.generated\.toml/);
  assert.match(source, /\bdatabase_name\b/);
  assert.match(
    source,
    /\botherwise\b[\s\S]{0,180}\b(?:approve|approval)\b/i,
    'without --dry-run, the documented mode must proceed through approval to writes',
  );
  assert.match(
    source,
    /(?:if|when)\s+(?:the\s+)?database(?:[- ]name)?\s+(?:argument\s+)?is\s+(?:omitted|absent|not supplied)[\s\S]{0,240}(?:generated[- ]config|wrangler\.generated\.toml|database_name)/i,
    'an omitted database must be resolved from the generated config database_name',
  );
});

test('preflight pins the working directory and fails closed on an unresolvable database id', () => {
  const preflight = markdownSection(skillSource(), /preflight/i);

  // Wrangler resolves the database through whichever config it finds by walking
  // up from the cwd, so the root requirement has to carry its reason: a run
  // started inside the worker directory resolves through a placeholder id and
  // dies before reading a row.
  assert.match(preflight, /\brepository root\b/i, 'preflight must pin the repository root');
  assert.match(
    preflight,
    /(?:never\s+change\s+directory|do\s+not\s+(?:cd|change\s+directory)|never\s+cd)/i,
    'preflight must forbid running from the worker directory',
  );
  assert.match(
    preflight,
    /searches\s+upward|upward\s+from\s+the\s+working\s+directory/i,
    'the root requirement must state why it is load-bearing',
  );

  assert.match(preflight, /\bdatabase_id\b/, 'preflight must inspect database_id');
  assert.match(preflight, /\bplaceholder\b/i, 'preflight must name the placeholder case');
  assert.match(
    preflight,
    /--database\s+<uuid>/i,
    'the placeholder case must direct the run to the UUID form',
  );
  assert.match(
    preflight,
    /never edit[\s\S]{0,120}wrangler\.toml/i,
    'preflight must forbid editing the placeholders-only config as a workaround',
  );
  assert.match(
    preflight,
    /accepts\s+no\s+UUID\s+override/i,
    'the migration remedy must state that it cannot take a UUID',
  );
  assert.match(
    preflight,
    /\bnum_tables\b[\s\S]{0,200}\bnot\b[\s\S]{0,40}\bschema\s+check\b/i,
    'preflight must reject num_tables as evidence of schema state',
  );
});

test('new-row reads use the required remote wrangler command', () => {
  const source = skillSource();
  const readCommand = shellBlocks(source).find(
    (block) => /\bSELECT\b/i.test(block) && /\bFROM\s+feedback\b/i.test(block),
  );
  assert.ok(readCommand, 'the skill must publish the feedback read SQL and remote Wrangler command');
  assertWranglerExecute(readCommand, 'the new-row read');
  assert.match(readCommand, /\bWHERE\s+status\s*=\s*['"]new['"]/i);
});

test('classification declares exactly the five outputs and gives each a decidable rule', () => {
  const section = markdownSection(skillSource(), /classif/i);

  const rows = [...section.matchAll(/^\|\s*\d+\s*\|\s*`([a-z-]+)`\s*\|\s*(.+?)\s*\|$/gm)];
  assert.deepEqual(
    [...rows.map((row) => row[1])].sort(),
    CLASSES,
    'the decision table must define exactly the five allowed outputs',
  );
  assert.match(section, /\bmutually\s+exclusive\b[\s\S]{0,80}\bexhaustive\b/i);

  for (const [, classification, signal] of rows) {
    assert.match(
      signal,
      /\b(?:if|when|where|contains?|matches?|mentions?|reports?|requests?|asks?|thanks?|gratitude|irrelevant|unsolicited|error|wrong|missing|broken)\b/i,
      `${classification} must have a decidable signal, not only a label`,
    );
  }
});

test('normalization and both duplicate keys are specified before issue creation', () => {
  const source = skillSource();

  assert.match(source, /\bUnicode(?:-aware)?\b[\s\S]{0,100}\b(?:case[- ]?fold|lowercase)\b/i);
  assert.match(
    source,
    /\b(?:collaps(?:e|es|ing)|replac(?:e|es|ing)\s+every\s+run\s+of)\b[\s\S]{0,100}\b(?:Unicode\s+|all\s+)?whitespace\b[\s\S]{0,100}\b(?:single|one)\s+ASCII\s+space\b/i,
  );
  assert.match(source, /\btrim(?:s|med|ming)?\b/i);
  assert.match(
    source,
    /normalized\s+message[\s\S]{0,180}\bsame\s+`?page`?|\bsame\s+`?page`?[\s\S]{0,180}normalized\s+message/i,
    'row deduplication must require both normalized message equality and the same page',
  );
  assert.match(
    source,
    /\bopen\b[\s\S]{0,180}\bissue\b[\s\S]{0,180}\bgenerated\s+title\b|\bgenerated\s+title\b[\s\S]{0,180}\bopen\b[\s\S]{0,180}\bissue\b/i,
    'an open target-repository issue with the generated title must be a duplicate',
  );
});

test('repository and article URL are derived from place config rather than hardcoded', () => {
  const source = skillSource();

  assert.match(source, /place\.config\.ts/);
  assert.match(source, /\blinks\.repo\b/);
  assert.match(source, /\bplace\.domain\b/);
  assert.match(source, /\b(?:for\s+each\s+row|row's)\b[\s\S]{0,100}`page`/i);
  assert.match(
    source,
    /(?:build|derive|resolve|concatenat|append|join|combine)\w*[\s\S]{0,220}place\.domain[\s\S]{0,220}(?:for\s+each\s+row[\s\S]{0,100}`page`|row's\s+`page`|row\.page)/i,
    'article URL must be place.domain plus the row page',
  );
});

test('GitHub commands target the configured repo and split create from duplicate comment', () => {
  const source = skillSource();
  const blocks = shellBlocks(source);
  const create = blocks.find((block) => /\bgh\s+issue\s+create\b/i.test(block));
  const comment = blocks.find((block) => /\bgh\s+issue\s+comment\b/i.test(block));

  assert.ok(create, 'the skill must publish a gh issue create command');
  assert.match(create, /\bgh\s+issue\s+create\b[\s\S]*\s--repo\s+\S+/i);
  assert.match(create, /\s--label(?:=|\s+)['"]?feedback['"]?\b/i);
  assert.match(create, /\s--body(?:-file)?(?:=|\s+)\S+/i);
  assert.match(source, /\barticle\s+URL\b/i);
  assert.match(source, /\bquoted\s+(?:submission|message)\b|\bblockquote\b|(?:^|\n)>\s/m);

  assert.ok(comment, 'the duplicate path must publish a gh issue comment command');
  assert.match(comment, /\s--repo\s+\S+/i);
  assert.match(
    source,
    /duplicate[\s\S]{0,320}\bcomment\b[\s\S]{0,240}(?:do not|must not|never|instead of)[\s\S]{0,120}\bcreat(?:e|ing)\b|duplicate[\s\S]{0,320}(?:instead of)[\s\S]{0,120}\bcreat(?:e|ing)\b/i,
    'duplicates must comment on the existing issue instead of creating another',
  );
});

test('dry-run forbids writes and live mode waits for explicit approval of a complete plan', () => {
  const source = skillSource();

  assert.match(
    source,
    /\bdry-run\b[\s\S]{0,320}\b(?:no|zero|must not|do not|never)\b[\s\S]{0,100}\b(?:writes?|mutat(?:e|ion)s?)\b/i,
    'dry-run must explicitly prohibit writes',
  );
  assert.match(
    source,
    /\bdry-run\b[\s\S]{0,420}\bGitHub\b[\s\S]{0,160}\bD1\b|\bdry-run\b[\s\S]{0,420}\bD1\b[\s\S]{0,160}\bGitHub\b/i,
    'the dry-run prohibition must name both GitHub and D1',
  );
  assert.match(source, /\bcomplete\s+plan\b/i);
  assert.match(source, /\bexplicit\s+(?:human\s+)?approval\b/i);
  assert.match(source, /\b(?:stop|pause|wait)\b[\s\S]{0,120}\bapproval\b/i);
  assert.match(
    source,
    /(?:all|every)\s+writes?\s+require[\s\S]{0,100}\bapproval\b|never\s+write[\s\S]{0,100}\b(?:before|without)\b[\s\S]{0,100}\bapproval\b/i,
    'the skill must state that every write requires approval',
  );

  const planIndex = source.search(/^##\s+\d*\.?\s*Display the complete plan/im);
  const approvalIndex = source.slice(planIndex).search(/\bexplicit\s+approval\b/i) + planIndex;
  const writesIndex = source.search(/^##\s+\d*\.?\s*Execute the approved writes/im);
  assert.ok(planIndex >= 0 && approvalIndex > planIndex && writesIndex > approvalIndex,
    'the workflow must display the plan, obtain explicit approval, then execute writes');
});

test('terminal D1 writes are safely quoted, remote, and guarded by status new', () => {
  const source = skillSource();
  const updates = codeBlocks(source, 'sql').filter(
    (block) => /\bUPDATE\s+feedback\b/i.test(block),
  );

  assert.ok(updates.length > 0, 'the skill must publish the feedback UPDATE SQL');
  for (const update of updates) {
    const where = update.match(/\bWHERE\b([\s\S]*)/i);
    assert.ok(where, 'every feedback update must have a WHERE clause');
    assert.match(where[1], /\bid\s*=/i, 'every feedback update must identify one row');
    assert.match(
      where[1],
      /\bstatus\s*=\s*['"]new['"]/i,
      'every feedback update must require status=new',
    );
  }
  const updateCommand = shellBlocks(source).find(
    (block) => /\bUPDATE\s+feedback\b/i.test(block) && /\bwrangler\s+d1\s+execute\b/i.test(block),
  );
  assert.ok(updateCommand, 'the skill must publish the feedback UPDATE command');
  assertWranglerExecute(updateCommand, 'every feedback write');

  assert.match(
    source,
    /(?:UTF-?8[\s\S]{0,100}\bhex\b|\bhex\b[\s\S]{0,100}X['"]|(?:double|doubling|replace)[\s\S]{0,120}\bsingle\s+quote)/i,
    'dynamic SQL values must use a documented injection-safe quoting or encoding method',
  );
  for (const value of ['URL', 'status', 'id']) {
    assert.match(
      source,
      new RegExp(`(?:arbitrary|dynamic)[^\\n]{0,140}\\b${value}\\b|\\b${value}\\b[^\\n]{0,140}(?:quote|encod|escape)`, 'i'),
      `${value} must be covered by the SQL-safety rule`,
    );
  }

  assert.match(
    source,
    /\bspam\b[\s\S]{0,220}\bstatus\b[\s\S]{0,80}['"`]?spam['"`]?\b[\s\S]{0,180}\bissue_url\b[\s\S]{0,80}\bNULL\b/i,
    'spam must end status=spam with issue_url=NULL',
  );
  assert.match(
    source,
    /\bnon-spam\b[\s\S]{0,260}\bstatus\b[\s\S]{0,80}['"`]?triaged['"`]?\b[\s\S]{0,220}\bissue_url\b[\s\S]{0,140}\b(?:created|existing)\b[\s\S]{0,80}\bissue\s+URL\b/i,
    'non-spam must end status=triaged with the created or existing issue URL',
  );
  assert.match(
    source,
    /\bspam\b[\s\S]{0,220}\b(?:no|must not|do not|never)\b[\s\S]{0,100}\bissue\b/i,
    'spam must never create or comment on an issue',
  );
});
