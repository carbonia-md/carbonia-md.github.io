/**
 * ui.ts — generic interface strings (English, plus Italian for the
 * instance-local multi-language experiment; see /PROGRESS.md).
 *
 * Trimmed en-only port of the fork's i18n bundle (task 1.1a). Holds ONLY
 * place-agnostic UI labels — nav chrome, footer section headers, search
 * affordances. Place strings (site name, category titles) never live here;
 * they flow from `place.config.ts`. This keeps the genericity gate green while
 * preserving the fork's `t()` call sites.
 */

export const defaultLang = 'en';
export const showDefaultLang = false;

export const ui = {
  en: {
    // header nav
    'nav.explore': 'Explore',
    'nav.latest': 'Latest',
    'nav.map': 'Map',
    'nav.graph': 'Knowledge Graph',
    'nav.about': 'About',
    'nav.contribute': 'Contribute',
    'nav.changelog': 'Changelog',
    'nav.dashboard': 'Dashboard',
    'nav.soundscape': 'Soundscape',
    'nav.chat': 'Ask',
    // header aria + search
    'nav.aria-home': 'Home',
    'nav.aria-main-navigation': 'Main navigation',
    'nav.aria-mobile-navigation': 'Mobile navigation',
    'nav.aria-search': 'Search',
    'nav.aria-toggle-menu': 'Toggle menu',
    'nav.search-placeholder': 'Search articles',
    'nav.search-type-to-search': 'Type to search across all articles',
    // footer
    'footer.explore': 'Explore',
    'footer.project': 'Project',
    'footer.contact': 'Contact',
    'footer.about': 'About',
    'footer.graph': 'Knowledge Graph',
    'footer.dashboard': 'Dashboard',
    'footer.soundscape': 'Soundscape',
    'footer.chat': 'Ask',
    'footer.contribute': 'Contribute',
    'footer.changelog': 'Changelog',
    'footer.report': 'Report an issue',
    'footer.discuss': 'Discussions',
    'footer.rss': 'RSS',
    'footer.builtWith': 'Built with Astro — open source, AI-friendly.',
    'footer.support': 'Support',
    'footer.support.cta': 'Star on GitHub',
    // article page
    'article.home': 'Home',
    'article.backToHome': 'Back to Home',
    // feedback widget (features.feedback + workers.feedback)
    'feedback.open': 'Give feedback',
    'feedback.close': 'Close feedback form',
    'feedback.heading': 'Something wrong on this page?',
    'feedback.intro':
      'Corrections, missing context, and questions all help. Every submission is read by a person.',
    'feedback.category.label': 'Kind of feedback',
    'feedback.category.correction': 'Correction',
    'feedback.category.addition': 'Missing information',
    'feedback.category.question': 'Question',
    'feedback.category.other': 'Something else',
    'feedback.message.label': 'Your feedback',
    'feedback.message.requirement': 'Enter 10 to 4,000 characters.',
    'feedback.message.placeholder': 'What should change, and why?',
    'feedback.contact.label': 'Email (optional, only used to reply)',
    // Rendered inside the honeypot's hidden, aria-hidden wrapper: a person never
    // sees or hears it, and a form-filling bot reads it as an ordinary label.
    'feedback.trap.label': 'Leave this field empty',
    'feedback.submit': 'Send feedback',
    'feedback.sending': 'Sending...',
    'feedback.success': 'Thank you. Your feedback was received.',
    // {field} is replaced with the field the endpoint rejected.
    'feedback.invalid': 'Please check the {field} field and try again.',
    'feedback.rateLimited':
      'Too many submissions from this network. Please try again later.',
    'feedback.error': 'Could not send your feedback. Please try again later.',
    'feedback.noscript': 'This form needs JavaScript. Email your feedback instead:',
    // chat page (features.chat + workers.chat)
    'chat.meta.title': 'Ask',
    'chat.meta.description':
      'Ask a question and get an answer drawn from this knowledge base, with links to the articles it came from.',
    'chat.hero.title': 'Ask the knowledge base',
    'chat.hero.subtitle':
      'Answers are assembled from the articles on this site and cite the ones they draw on. If the articles do not cover something, the answer will say so.',
    'chat.disabled.title': 'Chat is not enabled here',
    'chat.disabled.description':
      'This instance has no chat endpoint configured, so questions cannot be answered. Everything the chat would draw on is readable directly.',
    'chat.disabled.cta': 'Browse the articles',
    'chat.input.label': 'Your question',
    'chat.input.placeholder': 'What would you like to know?',
    'chat.send': 'Ask',
    'chat.sending': 'Thinking...',
    'chat.speaker.reader': 'You',
    'chat.speaker.guide': 'Answer',
    'chat.sources.title': 'Sources',
    'chat.sources.none': 'No sources found. Nothing in the knowledge base covers this.',
    'chat.transcript.label': 'Conversation',
    'chat.transcript.empty': 'Ask a question to start. The conversation clears when you close the tab.',
    'chat.error.rateLimited': 'Too many questions from this network. Please try again later.',
    'chat.error.unavailable': 'The answering service is unavailable right now. Please try again later.',
    'chat.error.generic': 'Could not get an answer. Please try again later.',
    // A turn whose sources arrived but whose answer text never did. The turn is not
    // kept, so the invitation to ask again is a promise the page can make.
    'chat.error.emptyAnswer':
      'No answer came back for this question, though the sources below were found. This turn was not kept, so asking again is safe.',
    // Same situation but the citations payload was empty, so the "sources below"
    // clause would contradict the "no sources found" text already rendered above.
    'chat.error.emptyAnswerNoSources':
      'No answer came back for this question. This turn was not kept, so asking again is safe.',
    'chat.noscript': 'Asking questions needs JavaScript. Browse the articles instead:',
    // The link under a `?ctx=` greeting, when that context declares an `article`.
    // Deliberately says nothing about the place: which place it is, is the greeting's
    // job, and this string ships to every instance.
    'chat.context.article': 'Read the article about this spot',
    // soundscape page (features.soundscape + knowledge/sounds/_manifest.md)
    'soundscape.meta.title': 'Soundscape',
    // Says how the audio plays, never where it came from: provenance is per clip,
    // in each manifest entry's own `credit`. A shared string cannot claim a field
    // recording on behalf of every instance -- the demo clips are synthesized.
    'soundscape.meta.description':
      'Audio from this knowledge base, played straight in the browser.',
    'soundscape.hero.title': 'Soundscape',
    'soundscape.hero.subtitle':
      'What this place sounds like. Each clip plays in the browser; nothing loads until you press play.',
    'soundscape.count': '{n} recordings',
    'soundscape.count.one': '1 recording',
    // Hero stats line. "Wanted" counts the wishlist entries across every
    // category: what this place is still missing is as much a fact about the
    // collection as what it has.
    'soundscape.stats.wanted': '{n} wanted',
    'soundscape.stats.wanted.one': '1 wanted',
    'soundscape.stats.categories': '{n} categories',
    'soundscape.stats.categories.one': '1 category',
    'soundscape.unsupported': 'Your browser cannot play this audio file.',
    // Per-category surfaces. A declared category renders even with nothing in it
    // yet -- the gap is the point, and the wishlist beside it says what would
    // fill it.
    'soundscape.category.empty': 'No recordings in this category yet.',
    'soundscape.category.article': 'Read the article',
    'soundscape.wishlist.title': 'Still wanted',
    // Contribute block. The steps are the actual mechanics of the manifest, so
    // they stay true for every instance; the call to action goes to /contribute,
    // which owns the full process.
    'soundscape.contribute.title': 'Add a recording',
    'soundscape.contribute.step.one':
      'Record the sound and export it as an MP3 you have the right to publish.',
    'soundscape.contribute.step.two':
      'Add the file under public/media/sounds/ in the repository.',
    'soundscape.contribute.step.three':
      'Describe it in knowledge/sounds/_manifest.md -- title, location, credit, and file -- and open a pull request.',
    'soundscape.contribute.cta': 'How to contribute',
    // Shown when no manifest exists, or it lists nothing playable. Documented
    // empty state: an adopted instance starts here until it adds its own audio.
    'soundscape.empty.title': 'No recordings yet',
    'soundscape.empty.description':
      'This knowledge base has not published any audio. Add entries to knowledge/sounds/_manifest.md and drop the files under public/media/sounds/ to fill this page.',

    // category hub
    'category.articleCount': '{n} articles',
    'category.readGuide': 'Read the full guide →',
    'category.topic': 'Topics',
    'category.otherTopics': 'Other Topics',
    'category.featured': 'Featured',
    'category.searchPlaceholder': 'Filter articles...',
    'category.noResults': 'No articles match your search.',
    'category.citations': '{n} citations',
    // hub essay / empty state
    'hub.essay.heading': 'Guide',
    'hub.empty.title': 'Coming Soon',
    'hub.empty.description':
      'We are working on content for this category.',
    'hub.empty.future': 'Planned coverage: ',

    // about page
    'about.meta.title': 'About',
    'about.meta.description':
      'The story behind this knowledge base, how it works, and how to contribute.',
    'about.naming.title': 'Why .md?',
    'about.naming.subtitle':
      'An open knowledge base in the most AI-friendly format',
    'about.naming.tech.title': 'Technical Level',
    'about.naming.tech.desc.html':
      ', the most universal document format in the programming world. Using the most AI-friendly format to share knowledge with the world.',
    'about.naming.symbol.title': 'Symbolic Level',
    'about.naming.symbol.desc.html':
      " happens to be Moldova's country-code top-level domain. Place + Markdown = connecting community knowledge through open source.",
    'about.naming.lucky.title': 'Open Source',
    'about.naming.lucky.desc':
      'Built on an open-source knowledge base framework. Community-driven, AI-friendly, and freely forkable for any city or topic.',
    'about.vision.p1':
      "This is more than a website. It's a curated knowledge base about a place with an outsized story.",
    'about.vision.p2':
      "With an open-source spirit, a curator's eye, and AI-friendly formats, we aim to provide the most comprehensive answer for anyone who wants to know this place, whether human or AI.",
    'about.vision.p3.html':
      'This is not a travel guide, not a real estate brochure, not an advertisement.<br />This is a living knowledge base, open and always evolving.',
    'about.origin.title': 'Origin',
    'about.origin.subtitle':
      'How this knowledge base came to be',
    'about.timeline.start.date': '2026',
    'about.timeline.start.title': 'The Framework',
    'about.timeline.start.desc':
      'Built on an open-source knowledge base framework: Astro static site, search indexing, quality gates, editorial standards, knowledge graph visualization, and the philosophy of "story over information."',
    'about.timeline.what.date': '2026',
    'about.timeline.what.title': 'What We Built',
    'about.timeline.what.desc':
      'Full-text search, automated quality checks, AI-friendly endpoints (/kb/, /llms.txt), RSS, sitemap, knowledge graph, and content covering multiple domains. Open source, open data, open to contributions.',
    'about.guide.title': 'One Layer Deeper',
    'about.guide.subtitle': 'Meta-articles about how this knowledge base works',
    'about.guide.born.title': 'How an Article Is Born',
    'about.guide.born.desc':
      'From idea to published article: research, writing, fact-checking, and the editorial pipeline.',
    'about.guide.viz.title': 'Visualization Catalog',
    'about.guide.viz.desc':
      'Every chart, map, and interactive element used across the site, cataloged.',
    'about.guide.meta.title': 'About This Project',
    'about.guide.meta.desc':
      'The technical architecture, design decisions, and philosophy behind the knowledge base.',
    'about.guide.cta': 'Read more',
    'about.faq.title': 'FAQ',
    'about.faq.subtitle': 'Common questions about this project',
    'about.faq.q1': 'Is this an official government project?',
    'about.faq.a1.html':
      'No. This is an independent, open-source project. It is not affiliated with any government, chamber of commerce, or tourism board.',
    'about.faq.q2': 'Can I use this content?',
    'about.faq.a2.html':
      'Yes. All content is licensed under <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>. You can share and adapt it with attribution.',
    'about.faq.q3': 'How can I contribute?',
    'about.faq.a3.html':
      'See the <a href="/contribute">Contribution Guide</a>. You can submit content via email or open a pull request on GitHub.',
    'about.contact.title': 'Contact',
    'about.contact.subtitle': 'Get in touch',
    'about.contact.cta.text':
      'Want to contribute or collaborate? We welcome all kinds of input.',

    // changelog page
    'changelog.meta.title': 'Changelog',
    'changelog.meta.description':
      'Update history — track every content addition and site improvement.',

    // contribute page
    'contribute.meta.title': 'Contribute',
    'contribute.meta.description':
      'How to contribute to this open-source knowledge base.',
    'contribute.hero.title': 'Contribute',
    'contribute.hero.subtitle':
      'This knowledge base is open source. Every article, every source, every line of code is public. If you know something we missed, you can fix it.',
    'contribute.how.title': 'How It Works',
    'contribute.how.md.title': '1. Write in Markdown',
    'contribute.how.md.desc':
      'Articles are plain .md files. Write your knowledge, add sources, and submit.',
    'contribute.how.review.title': '2. Review',
    'contribute.how.review.desc':
      'Every submission goes through fact-checking and editorial review before publishing.',
    'contribute.how.publish.title': '3. Publish',
    'contribute.how.publish.desc':
      'Approved articles go live on the site, credited to you, and become part of the permanent knowledge base.',
    'contribute.paths.title': 'Ways to Contribute',
    'contribute.paths.easy.badge': 'Easy',
    'contribute.paths.easy.title': 'Share What You Know',
    'contribute.paths.easy.desc':
      'Send us your knowledge via email. No technical skills required.',
    'contribute.paths.easy.feature1': 'No GitHub account needed',
    'contribute.paths.easy.feature2': 'Write in any format',
    'contribute.paths.easy.feature3': 'We handle the formatting',
    'contribute.paths.easy.button': 'Email Your Contribution',
    'contribute.paths.dev.badge': 'Developer',
    'contribute.paths.dev.title': 'Open a Pull Request',
    'contribute.paths.dev.desc':
      'Fork the repo, add or edit articles, and submit a PR.',
    'contribute.paths.dev.feature1': 'Full editorial control',
    'contribute.paths.dev.feature2': 'See your changes in preview',
    'contribute.paths.dev.feature3': 'Direct credit in git history',
    'contribute.paths.dev.button': 'View on GitHub',
    'contribute.guides.title': 'Writing Guidelines',
    'contribute.guides.desc':
      'A few principles that keep the knowledge base consistent and trustworthy.',
    'contribute.guides.writing.title': 'Writing Standards',
    'contribute.guides.writing.desc':
      'Good articles tell stories, not just list facts.',
    'contribute.guides.writing.rule1': 'Lead with narrative, support with evidence',
    'contribute.guides.writing.rule2': 'Cite primary sources whenever possible',
    'contribute.guides.writing.rule3': 'Write for density: every sentence should earn its place',
    'contribute.guides.images.title': 'Image Guidelines',
    'contribute.guides.images.desc':
      'Images must be properly licensed and attributed.',
    'contribute.guides.images.rule1': 'Wikimedia Commons (preferred)',
    'contribute.guides.images.rule2': 'Government/public domain sources',
    'contribute.guides.images.rule3': 'Your own photography (with release)',
    'contribute.ideas.title': 'Article Ideas',
    'contribute.ideas.idea1': 'Local history that is not on Wikipedia',
    'contribute.ideas.idea2': 'Recipes with cultural context',
    'contribute.ideas.idea3': 'Oral histories from longtime residents',
    'contribute.ideas.idea4': 'Hidden spots only locals know',
    'contribute.ideas.idea5': 'Stories from community elders',
    'contribute.ideas.idea6': 'Nature observations and seasonal patterns',

    // reader-facing page text moved out of templates (M3)
    'article.toc.aria': 'Table of contents',
    'article.toc.title': 'Contents',
    'article.breadcrumb': 'Breadcrumb',
    'article.originalSource': 'Original source',
    'article.sources': 'Sources',
    'article.aiNotice.title': 'AI-Assisted Content',
    'article.aiNotice.body': 'This article was researched and written with AI assistance. All claims are source-traced; factual errors should be reported via GitHub.',
    'article.edit': 'Edit this page',
    'article.reportIssue': 'Report issue',
    'article.share': 'Share',
    'article.shareX': 'Share on X',
    'article.shareFacebook': 'Share on Facebook',
    'article.copyLink': 'Copy link',
    'article.copied': 'Copied!',
    'article.latest.eyebrow': 'Latest',
    'article.latest.title': 'Latest on the site',
    'article.read': 'Read',
    'article.keepExploring': 'Keep exploring',
    'article.moreToDiscover': 'More to discover',
    'article.minRead': '{n} min read',
    'article.keywords': 'Keywords',
    'article.contributors': 'Contributors',
    'article.related': 'Related',
    'article.citations': 'Citations',
    'home.meta.title': 'Home',
    'latest.meta.title': 'Latest',
    'latest.meta.description': 'Recently added and updated articles, newest first.',
    'latest.all': 'All',
    'latest.empty': 'No articles yet.',
    'explore.meta.title': 'Explore',
    'explore.meta.description': 'Search across all articles and browse every topic on {name}.',
    'explore.intro': 'Full-text search across every article, or browse by topic.',
    'explore.articleCount': '{n} articles.',
    'explore.search.aria': 'Search all articles',
    'explore.search.label': 'Search across all articles…',
    'explore.random.aria': 'Random article',
    'explore.random.label': 'Surprise me',
    'explore.byTopic': 'Browse by Topic',
    'explore.latest': 'Latest',
    'explore.seeAll': 'See all',
    'explore.more': 'More ways to explore',
    'explore.graph.desc': 'See how every topic connects.',
    'explore.map.desc': 'Browse everything by location.',
    'map.meta.title': 'Map of {name}',
    'map.intro': 'Explore the places behind the articles — pick a category or area, or tap a marker.',
    'map.filter.areas': 'Neighborhoods',
    'map.filter.category': 'Category',
    'map.filter.all': 'All',
    'map.popup.read': 'Read the article',
    'graph.search.placeholder': 'Search nodes or articles',
    'graph.search.aria': 'Search knowledge graph nodes',
    'categoryGrid.aria': 'Category grid',
    'home.doors.aria': 'Quick navigation',
    'categoryGrid.explore': 'Explore',
    'about.contact.collaboration': 'Collaboration',
    'about.contact.openSource': 'Open Source',
    'about.contact.license': 'License',
    'about.contact.guide': 'Contribution Guide',
    'nav.aria-expand-submenu': 'Expand submenu',
    'nav.aria-language': 'Language',
    'graph.subtitle': 'All knowledge nodes and connections in {name}',
    'categoryGrid.article': 'article',
    'categoryGrid.articles': 'articles',
    'changelog.hero.title': 'Update History',
    'changelog.hero.subtitle': 'Track every content addition and site improvement.',
    'changelog.count': '{n} updates',
    'changelog.source.git': 'From local git history',
    'changelog.source.cache': 'From the build-time cached commit feed',
    'changelog.source.github': 'From the GitHub commit feed',
    'changelog.source.none': 'Updates are temporarily unavailable',
    'changelog.search.placeholder': 'Search updates...',
    'changelog.filter.all': 'All',
    'changelog.filter.feat': 'Feature',
    'changelog.filter.fix': 'Fix',
    'changelog.filter.content': 'Content',
    'changelog.filter.merge': 'Merge',
    'changelog.filter.maintenance': 'Maintenance',
    'changelog.unavailable.title': 'Update history is temporarily unavailable',
    'changelog.unavailable.desc': 'This page reads from git, then falls back to a build-time cache and GitHub.',
    'changelog.viewOnGitHub': 'View on GitHub',
  },
  // Italian (instance-local multi-language experiment, see /PROGRESS.md M3).
  // Must carry every `en` key: `npm run i18n:parity` fails the build otherwise.
  it: {
    // header nav
    'nav.explore': 'Esplora',
    'nav.latest': 'Novità',
    'nav.map': 'Mappa',
    'nav.graph': 'Grafo della conoscenza',
    'nav.about': 'Chi siamo',
    'nav.contribute': 'Contribuisci',
    'nav.changelog': 'Registro modifiche',
    'nav.dashboard': 'Dashboard',
    'nav.soundscape': 'Paesaggio sonoro',
    'nav.chat': 'Chiedi',
    // header aria + search
    'nav.aria-home': 'Home',
    'nav.aria-main-navigation': 'Navigazione principale',
    'nav.aria-mobile-navigation': 'Navigazione mobile',
    'nav.aria-search': 'Cerca',
    'nav.aria-toggle-menu': 'Apri o chiudi il menu',
    'nav.search-placeholder': 'Cerca articoli',
    'nav.search-type-to-search': 'Scrivi per cercare in tutti gli articoli',
    // footer
    'footer.explore': 'Esplora',
    'footer.project': 'Progetto',
    'footer.contact': 'Contatti',
    'footer.about': 'Chi siamo',
    'footer.graph': 'Grafo della conoscenza',
    'footer.dashboard': 'Dashboard',
    'footer.soundscape': 'Paesaggio sonoro',
    'footer.chat': 'Chiedi',
    'footer.contribute': 'Contribuisci',
    'footer.changelog': 'Registro modifiche',
    'footer.report': 'Segnala un problema',
    'footer.discuss': 'Discussioni',
    'footer.rss': 'RSS',
    'footer.builtWith': 'Realizzato con Astro — open source, pensato anche per l\'IA.',
    'footer.support': 'Sostieni',
    'footer.support.cta': 'Metti una stella su GitHub',
    // article page
    'article.home': 'Home',
    'article.backToHome': 'Torna alla home',
    // feedback widget (features.feedback + workers.feedback)
    'feedback.open': 'Lascia un commento',
    'feedback.close': 'Chiudi il modulo',
    'feedback.heading': 'Qualcosa non va in questa pagina?',
    'feedback.intro':
      'Correzioni, contesto mancante e domande sono tutti utili. Ogni segnalazione viene letta da una persona.',
    'feedback.category.label': 'Tipo di segnalazione',
    'feedback.category.correction': 'Correzione',
    'feedback.category.addition': 'Informazione mancante',
    'feedback.category.question': 'Domanda',
    'feedback.category.other': 'Altro',
    'feedback.message.label': 'Il tuo messaggio',
    'feedback.message.requirement': 'Da 10 a 4.000 caratteri.',
    'feedback.message.placeholder': 'Cosa andrebbe cambiato, e perché?',
    'feedback.contact.label': 'Email (facoltativa, usata solo per risponderti)',
    'feedback.trap.label': 'Lascia vuoto questo campo',
    'feedback.submit': 'Invia',
    'feedback.sending': 'Invio in corso...',
    'feedback.success': 'Grazie. Abbiamo ricevuto la tua segnalazione.',
    'feedback.invalid': 'Controlla il campo {field} e riprova.',
    'feedback.rateLimited':
      'Troppe segnalazioni da questa rete. Riprova più tardi.',
    'feedback.error': 'Impossibile inviare la segnalazione. Riprova più tardi.',
    'feedback.noscript': 'Questo modulo richiede JavaScript. Puoi inviare la tua segnalazione via email:',
    // chat page (features.chat + workers.chat)
    'chat.meta.title': 'Chiedi',
    'chat.meta.description':
      'Fai una domanda e ricevi una risposta tratta da questa base di conoscenza, con i link agli articoli da cui proviene.',
    'chat.hero.title': 'Chiedi alla base di conoscenza',
    'chat.hero.subtitle':
      'Le risposte sono costruite a partire dagli articoli di questo sito e citano quelli da cui attingono. Se gli articoli non trattano un argomento, la risposta lo dirà.',
    'chat.disabled.title': 'La chat non è attiva qui',
    'chat.disabled.description':
      'Questa istanza non ha un servizio di chat configurato, quindi non può rispondere alle domande. Tutto ciò su cui la chat si baserebbe è comunque leggibile direttamente.',
    'chat.disabled.cta': 'Sfoglia gli articoli',
    'chat.input.label': 'La tua domanda',
    'chat.input.placeholder': 'Cosa vorresti sapere?',
    'chat.send': 'Chiedi',
    'chat.sending': 'Sto pensando...',
    'chat.speaker.reader': 'Tu',
    'chat.speaker.guide': 'Risposta',
    'chat.sources.title': 'Fonti',
    'chat.sources.none': 'Nessuna fonte trovata. Nulla nella base di conoscenza tratta questo argomento.',
    'chat.transcript.label': 'Conversazione',
    'chat.transcript.empty': 'Fai una domanda per iniziare. La conversazione si cancella quando chiudi la scheda.',
    'chat.error.rateLimited': 'Troppe domande da questa rete. Riprova più tardi.',
    'chat.error.unavailable': 'Il servizio di risposta non è disponibile al momento. Riprova più tardi.',
    'chat.error.generic': 'Impossibile ottenere una risposta. Riprova più tardi.',
    'chat.error.emptyAnswer':
      'Non è arrivata nessuna risposta a questa domanda, anche se sono state trovate le fonti qui sotto. Questo scambio non è stato salvato, quindi puoi chiedere di nuovo.',
    'chat.error.emptyAnswerNoSources':
      'Non è arrivata nessuna risposta a questa domanda. Questo scambio non è stato salvato, quindi puoi chiedere di nuovo.',
    'chat.noscript': 'Per fare domande serve JavaScript. Puoi invece sfogliare gli articoli:',
    'chat.context.article': 'Leggi l\'articolo su questo luogo',
    // soundscape page (features.soundscape + knowledge/sounds/_manifest.md)
    'soundscape.meta.title': 'Paesaggio sonoro',
    'soundscape.meta.description':
      'Audio da questa base di conoscenza, riprodotto direttamente nel browser.',
    'soundscape.hero.title': 'Paesaggio sonoro',
    'soundscape.hero.subtitle':
      'Il suono di questo luogo. Ogni clip si ascolta nel browser; nulla viene caricato finché non premi play.',
    'soundscape.count': '{n} registrazioni',
    'soundscape.count.one': '1 registrazione',
    'soundscape.stats.wanted': '{n} cercate',
    'soundscape.stats.wanted.one': '1 cercata',
    'soundscape.stats.categories': '{n} categorie',
    'soundscape.stats.categories.one': '1 categoria',
    'soundscape.unsupported': 'Il tuo browser non può riprodurre questo file audio.',
    'soundscape.category.empty': 'Ancora nessuna registrazione in questa categoria.',
    'soundscape.category.article': 'Leggi l\'articolo',
    'soundscape.wishlist.title': 'Ancora cercate',
    'soundscape.contribute.title': 'Aggiungi una registrazione',
    'soundscape.contribute.step.one':
      'Registra il suono ed esportalo come MP3 che hai il diritto di pubblicare.',
    'soundscape.contribute.step.two':
      'Aggiungi il file in public/media/sounds/ nel repository.',
    'soundscape.contribute.step.three':
      'Descrivilo in knowledge/sounds/_manifest.md -- titolo, luogo, crediti e file -- e apri una pull request.',
    'soundscape.contribute.cta': 'Come contribuire',
    'soundscape.empty.title': 'Ancora nessuna registrazione',
    'soundscape.empty.description':
      'Questa base di conoscenza non ha ancora pubblicato audio. Aggiungi voci a knowledge/sounds/_manifest.md e inserisci i file in public/media/sounds/ per riempire questa pagina.',

    // category hub
    'category.articleCount': '{n} articoli',
    'category.readGuide': 'Leggi la guida completa →',
    'category.topic': 'Argomenti',
    'category.otherTopics': 'Altri argomenti',
    'category.featured': 'In evidenza',
    'category.searchPlaceholder': 'Filtra gli articoli...',
    'category.noResults': 'Nessun articolo corrisponde alla ricerca.',
    'category.citations': '{n} citazioni',
    // hub essay / empty state
    'hub.essay.heading': 'Guida',
    'hub.empty.title': 'In arrivo',
    'hub.empty.description':
      'Stiamo lavorando ai contenuti di questa categoria.',
    'hub.empty.future': 'Argomenti previsti: ',

    // about page
    'about.meta.title': 'Chi siamo',
    'about.meta.description':
      'La storia di questa base di conoscenza, come funziona e come contribuire.',
    'about.naming.title': 'Perché .md?',
    'about.naming.subtitle':
      'Una base di conoscenza aperta nel formato più adatto all\'IA',
    'about.naming.tech.title': 'Livello tecnico',
    'about.naming.tech.desc.html':
      ', il formato di documento più universale nel mondo della programmazione. Usiamo il formato più adatto all\'IA per condividere conoscenza con il mondo.',
    'about.naming.symbol.title': 'Livello simbolico',
    'about.naming.symbol.desc.html':
      ' è anche il dominio di primo livello nazionale della Moldavia. Luogo + Markdown = conoscenza della comunità connessa attraverso l\'open source.',
    'about.naming.lucky.title': 'Open source',
    'about.naming.lucky.desc':
      'Costruita su un framework open source per basi di conoscenza. Guidata dalla comunità, pensata per l\'IA e liberamente riutilizzabile per qualsiasi città o tema.',
    'about.vision.p1':
      'Questo è più di un sito web. È una base di conoscenza curata su un luogo con una storia fuori dal comune.',
    'about.vision.p2':
      'Con spirito open source, l\'occhio di un curatore e formati adatti all\'IA, vogliamo offrire la risposta più completa a chiunque voglia conoscere questo luogo, persona o IA che sia.',
    'about.vision.p3.html':
      'Non è una guida turistica, non è una brochure immobiliare, non è una pubblicità.<br />È una base di conoscenza viva, aperta e in continua evoluzione.',
    'about.origin.title': 'Origini',
    'about.origin.subtitle':
      'Come è nata questa base di conoscenza',
    'about.timeline.start.date': '2026',
    'about.timeline.start.title': 'Il framework',
    'about.timeline.start.desc':
      'Costruita su un framework open source per basi di conoscenza: sito statico Astro, indicizzazione per la ricerca, controlli di qualità, standard editoriali, visualizzazione a grafo della conoscenza e la filosofia della "storia prima dell\'informazione".',
    'about.timeline.what.date': '2026',
    'about.timeline.what.title': 'Cosa abbiamo costruito',
    'about.timeline.what.desc':
      'Ricerca full-text, controlli di qualità automatici, endpoint per l\'IA (/kb/, /llms.txt), RSS, sitemap, grafo della conoscenza e contenuti su più ambiti. Open source, dati aperti, aperta ai contributi.',
    'about.guide.title': 'Un livello più a fondo',
    'about.guide.subtitle': 'Meta-articoli su come funziona questa base di conoscenza',
    'about.guide.born.title': 'Come nasce un articolo',
    'about.guide.born.desc':
      'Dall\'idea all\'articolo pubblicato: ricerca, scrittura, verifica dei fatti e il processo editoriale.',
    'about.guide.viz.title': 'Catalogo delle visualizzazioni',
    'about.guide.viz.desc':
      'Ogni grafico, mappa ed elemento interattivo usato nel sito, catalogato.',
    'about.guide.meta.title': 'Il progetto',
    'about.guide.meta.desc':
      'L\'architettura tecnica, le scelte di design e la filosofia dietro la base di conoscenza.',
    'about.guide.cta': 'Leggi di più',
    'about.faq.title': 'Domande frequenti',
    'about.faq.subtitle': 'Domande comuni su questo progetto',
    'about.faq.q1': 'È un progetto ufficiale dell\'amministrazione pubblica?',
    'about.faq.a1.html':
      'No. È un progetto indipendente e open source. Non è affiliato ad alcuna amministrazione pubblica, camera di commercio o ente del turismo.',
    'about.faq.q2': 'Posso usare questi contenuti?',
    'about.faq.a2.html':
      'Sì. Tutti i contenuti sono distribuiti con licenza <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.it">CC BY-SA 4.0</a>. Puoi condividerli e adattarli citando la fonte.',
    'about.faq.q3': 'Come posso contribuire?',
    'about.faq.a3.html':
      'Leggi la <a href="/it/contribute">guida per contribuire</a>. Puoi inviare contenuti via email o aprire una pull request su GitHub.',
    'about.contact.title': 'Contatti',
    'about.contact.subtitle': 'Scrivici',
    'about.contact.cta.text':
      'Vuoi contribuire o collaborare? Ogni tipo di contributo è benvenuto.',

    // changelog page
    'changelog.meta.title': 'Registro modifiche',
    'changelog.meta.description':
      'Cronologia degli aggiornamenti: ogni nuovo contenuto e ogni miglioramento del sito.',

    // contribute page
    'contribute.meta.title': 'Contribuisci',
    'contribute.meta.description':
      'Come contribuire a questa base di conoscenza open source.',
    'contribute.hero.title': 'Contribuisci',
    'contribute.hero.subtitle':
      'Questa base di conoscenza è open source. Ogni articolo, ogni fonte, ogni riga di codice è pubblica. Se sai qualcosa che ci è sfuggito, puoi correggerlo.',
    'contribute.how.title': 'Come funziona',
    'contribute.how.md.title': '1. Scrivi in Markdown',
    'contribute.how.md.desc':
      'Gli articoli sono semplici file .md. Scrivi ciò che sai, aggiungi le fonti e invia.',
    'contribute.how.review.title': '2. Revisione',
    'contribute.how.review.desc':
      'Ogni contributo passa per la verifica dei fatti e la revisione editoriale prima della pubblicazione.',
    'contribute.how.publish.title': '3. Pubblicazione',
    'contribute.how.publish.desc':
      'Gli articoli approvati vengono pubblicati sul sito con il tuo nome e diventano parte permanente della base di conoscenza.',
    'contribute.paths.title': 'Modi per contribuire',
    'contribute.paths.easy.badge': 'Facile',
    'contribute.paths.easy.title': 'Condividi ciò che sai',
    'contribute.paths.easy.desc':
      'Inviaci le tue conoscenze via email. Non servono competenze tecniche.',
    'contribute.paths.easy.feature1': 'Non serve un account GitHub',
    'contribute.paths.easy.feature2': 'Scrivi in qualsiasi formato',
    'contribute.paths.easy.feature3': 'Alla formattazione pensiamo noi',
    'contribute.paths.easy.button': 'Invia il tuo contributo via email',
    'contribute.paths.dev.badge': 'Sviluppatori',
    'contribute.paths.dev.title': 'Apri una pull request',
    'contribute.paths.dev.desc':
      'Fai un fork del repository, aggiungi o modifica articoli e invia una PR.',
    'contribute.paths.dev.feature1': 'Pieno controllo editoriale',
    'contribute.paths.dev.feature2': 'Anteprima delle tue modifiche',
    'contribute.paths.dev.feature3': 'Riconoscimento diretto nella cronologia git',
    'contribute.paths.dev.button': 'Vedi su GitHub',
    'contribute.guides.title': 'Linee guida per la scrittura',
    'contribute.guides.desc':
      'Alcuni principi che mantengono la base di conoscenza coerente e affidabile.',
    'contribute.guides.writing.title': 'Standard di scrittura',
    'contribute.guides.writing.desc':
      'I buoni articoli raccontano storie, non si limitano a elencare fatti.',
    'contribute.guides.writing.rule1': 'Apri con il racconto, sostienilo con le prove',
    'contribute.guides.writing.rule2': 'Cita le fonti primarie quando possibile',
    'contribute.guides.writing.rule3': 'Scrivi in modo denso: ogni frase deve meritarsi il suo posto',
    'contribute.guides.images.title': 'Linee guida per le immagini',
    'contribute.guides.images.desc':
      'Le immagini devono avere una licenza adeguata e i crediti corretti.',
    'contribute.guides.images.rule1': 'Wikimedia Commons (preferibile)',
    'contribute.guides.images.rule2': 'Fonti pubbliche o di pubblico dominio',
    'contribute.guides.images.rule3': 'Le tue fotografie (con liberatoria)',
    'contribute.ideas.title': 'Idee per articoli',
    'contribute.ideas.idea1': 'Storia locale che non si trova su Wikipedia',
    'contribute.ideas.idea2': 'Ricette con il loro contesto culturale',
    'contribute.ideas.idea3': 'Racconti orali di residenti di lunga data',
    'contribute.ideas.idea4': 'Luoghi nascosti che conoscono solo gli abitanti',
    'contribute.ideas.idea5': 'Storie degli anziani della comunità',
    'contribute.ideas.idea6': 'Osservazioni sulla natura e sui cicli stagionali',

    // reader-facing page text moved out of templates (M3)
    'article.toc.aria': 'Indice',
    'article.toc.title': 'Indice',
    'article.breadcrumb': 'Percorso di navigazione',
    'article.originalSource': 'Fonte originale',
    'article.sources': 'Fonti',
    'article.aiNotice.title': 'Contenuto realizzato con l\'aiuto dell\'IA',
    'article.aiNotice.body': 'Questo articolo è stato ricercato e scritto con l\'assistenza dell\'IA. Ogni affermazione è collegata alla sua fonte; eventuali errori vanno segnalati su GitHub.',
    'article.edit': 'Modifica questa pagina',
    'article.reportIssue': 'Segnala un problema',
    'article.share': 'Condividi',
    'article.shareX': 'Condividi su X',
    'article.shareFacebook': 'Condividi su Facebook',
    'article.copyLink': 'Copia link',
    'article.copied': 'Copiato!',
    'article.latest.eyebrow': 'Novità',
    'article.latest.title': 'Le ultime dal sito',
    'article.read': 'Leggi',
    'article.keepExploring': 'Continua a esplorare',
    'article.moreToDiscover': 'Altro da scoprire',
    'article.minRead': '{n} min di lettura',
    'article.keywords': 'Parole chiave',
    'article.contributors': 'Hanno contribuito',
    'article.related': 'Articoli correlati',
    'article.citations': 'Citazioni',
    'home.meta.title': 'Home',
    'latest.meta.title': 'Novità',
    'latest.meta.description': 'Articoli aggiunti e aggiornati di recente, dal più nuovo.',
    'latest.all': 'Tutti',
    'latest.empty': 'Ancora nessun articolo.',
    'explore.meta.title': 'Esplora',
    'explore.meta.description': 'Cerca tra tutti gli articoli ed esplora ogni argomento su {name}.',
    'explore.intro': 'Ricerca full-text in tutti gli articoli, oppure sfoglia per argomento.',
    'explore.articleCount': '{n} articoli.',
    'explore.search.aria': 'Cerca in tutti gli articoli',
    'explore.search.label': 'Cerca in tutti gli articoli…',
    'explore.random.aria': 'Articolo a caso',
    'explore.random.label': 'Sorprendimi',
    'explore.byTopic': 'Sfoglia per argomento',
    'explore.latest': 'Novità',
    'explore.seeAll': 'Vedi tutto',
    'explore.more': 'Altri modi per esplorare',
    'explore.graph.desc': 'Scopri come si collegano tutti gli argomenti.',
    'explore.map.desc': 'Esplora tutto per luogo.',
    'map.meta.title': 'Mappa di {name}',
    'map.intro': 'Esplora i luoghi dietro gli articoli: scegli una categoria o una zona, oppure tocca un indicatore.',
    'map.filter.areas': 'Quartieri',
    'map.filter.category': 'Categoria',
    'map.filter.all': 'Tutti',
    'map.popup.read': 'Leggi l\'articolo',
    'graph.search.placeholder': 'Cerca nodi o articoli',
    'graph.search.aria': 'Cerca nel grafo della conoscenza',
    'categoryGrid.aria': 'Griglia delle categorie',
    'home.doors.aria': 'Navigazione rapida',
    'categoryGrid.explore': 'Esplora',
    'about.contact.collaboration': 'Collaborazioni',
    'about.contact.openSource': 'Open source',
    'about.contact.license': 'Licenza',
    'about.contact.guide': 'Guida per contribuire',
    'nav.aria-expand-submenu': 'Espandi il sottomenu',
    'nav.aria-language': 'Lingua',
    'graph.subtitle': 'Tutti i nodi e i collegamenti della conoscenza su {name}',
    'categoryGrid.article': 'articolo',
    'categoryGrid.articles': 'articoli',
    'changelog.hero.title': 'Cronologia degli aggiornamenti',
    'changelog.hero.subtitle': 'Segui ogni nuovo contenuto e ogni miglioramento del sito.',
    'changelog.count': '{n} aggiornamenti',
    'changelog.source.git': 'Dalla cronologia git locale',
    'changelog.source.cache': 'Dal feed dei commit salvato durante la build',
    'changelog.source.github': 'Dal feed dei commit di GitHub',
    'changelog.source.none': 'Gli aggiornamenti non sono disponibili al momento',
    'changelog.search.placeholder': 'Cerca negli aggiornamenti...',
    'changelog.filter.all': 'Tutti',
    'changelog.filter.feat': 'Novità',
    'changelog.filter.fix': 'Correzioni',
    'changelog.filter.content': 'Contenuti',
    'changelog.filter.merge': 'Merge',
    'changelog.filter.maintenance': 'Manutenzione',
    'changelog.unavailable.title': 'La cronologia degli aggiornamenti non è disponibile al momento',
    'changelog.unavailable.desc': 'Questa pagina legge da git e, in mancanza, da una cache creata durante la build e da GitHub.',
    'changelog.viewOnGitHub': 'Vedi su GitHub',
  },
} as const;
