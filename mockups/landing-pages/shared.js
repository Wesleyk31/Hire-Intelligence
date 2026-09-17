/* Preview-only interaction layer. No API calls, analytics, cookies or browser storage. */
(() => {
  'use strict';
  const concepts = [
    ['01-fieldnotes.html', 'Fieldnotes'],
    ['02-signal-room.html', 'Signal Room'],
    ['03-territory.html', 'Territory'],
    ['04-fleet-forward.html', 'Fleet Forward'],
    ['05-evidence-to-action.html', 'Evidence to Action'],
  ];
  const concept = Number(document.body.dataset.concept || 1);
  const thumbnail = new URLSearchParams(location.search).has('thumbnail');
  if (thumbnail) document.body.classList.add('thumbnail-mode');
  const previewBar = document.querySelector('[data-preview-bar]');
  if (previewBar) previewBar.innerHTML = `<a class="skip-link" href="#main">Skip to content</a><div class="preview-bar"><a href="./index.html">← All five concepts</a><span class="preview-context">${String(concept).padStart(2, '0')} / ${concepts[concept - 1][1]} · Local design preview · Sample content</span><nav class="preview-links" aria-label="Switch landing-page concept">${concepts.map(([file, name], index) => `<a href="./${file}" aria-label="Concept ${index + 1}: ${name}" ${concept === index + 1 ? 'aria-current="page"' : ''}>0${index + 1}</a>`).join('')}</nav></div>`;
  const header = document.querySelector('[data-site-header]');
  if (header) header.innerHTML = `<header class="site-header wrap"><a class="brand" href="/" aria-label="Hire Intelligence current homepage"><span class="brand-mark" aria-hidden="true"></span>Hire Intelligence</a><button class="menu-toggle" aria-expanded="false" aria-controls="primary-navigation">Menu +</button><nav class="site-nav" id="primary-navigation" aria-label="Primary navigation"><a href="#explore">Explore</a><a href="#approach">Our approach</a><a href="/#products">Platform</a><a href="/#about">About</a></nav><div class="header-actions"><a class="login-link" href="/#platform/decision-desk">Workspace ↗</a><button class="button" data-demo>Get a demo <span aria-hidden="true">↗</span></button></div></header>`;
  const footer = document.querySelector('[data-site-footer]');
  if (footer) footer.innerHTML = `<footer class="site-footer wrap"><div class="footer-brand"><a class="brand" href="/"><span class="brand-mark" aria-hidden="true"></span>Hire Intelligence</a><p>A clearer view of the work ahead.</p></div><nav class="footer-links" aria-label="Footer navigation"><a href="/#privacy">Privacy</a><a href="/#terms">Terms</a><a href="/#contact">Contact</a><a href="./index.html">All concepts</a></nav></footer><p class="concept-note wrap">Design concept ${String(concept).padStart(2, '0')} / ${concepts[concept - 1][1]}. Sample cards and maps are illustrative. Demo forms simulate a request locally; no details are sent or stored.</p>`;
  const dialogs = document.querySelector('[data-dialogs]');
  if (dialogs) dialogs.innerHTML = `<dialog class="preview-dialog" id="demo-dialog" aria-labelledby="demo-title" aria-describedby="demo-disclosure"><button class="dialog-close" data-close aria-label="Close demo preview">×</button><p class="eyebrow">LOCAL INTERACTION PREVIEW</p><h2 id="demo-title">See how a demo request could feel.</h2><p>This form demonstrates the proposed landing-page interaction.</p><div class="demo-disclosure" id="demo-disclosure"><strong>Preview only.</strong> No request will be sent and nothing is stored. Use sample details to try the form.</div><form class="demo-preview-form"><label>Name<input name="name" required autocomplete="off" placeholder="Sample name"></label><label>Company<input name="company" required autocomplete="off" placeholder="Sample company"></label><label class="wide">Business email<input name="email" type="email" required autocomplete="off" placeholder="sample@example.com"></label><label class="wide">What would you like to explore?<textarea name="message" rows="2" placeholder="For example, regional project intelligence"></textarea></label><button class="button wide" type="submit">Simulate demo request <span aria-hidden="true">→</span></button><p class="demo-status wide" role="status" aria-live="polite"></p></form><a class="dialog-bottom-link" href="/#contact">Go to the current site’s contact page ↗</a></dialog><dialog class="preview-dialog" id="detail-dialog" aria-labelledby="detail-title"><button class="dialog-close" data-close aria-label="Close sample detail">×</button><div class="detail-content"></div></dialog>`;

  const menuButton = document.querySelector('.menu-toggle');
  const siteHeader = document.querySelector('.site-header');
  function closeMenu() {
    siteHeader?.classList.remove('menu-open');
    menuButton?.setAttribute('aria-expanded', 'false');
    if (menuButton) menuButton.textContent = 'Menu +';
  }
  menuButton?.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') !== 'true';
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.textContent = open ? 'Close −' : 'Menu +';
    siteHeader?.classList.toggle('menu-open', open);
  });
  document.querySelectorAll('.site-nav a').forEach((link) => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && siteHeader?.classList.contains('menu-open')) {
      closeMenu();
      menuButton?.focus();
    }
  });

  const details = {
    approval: { eyebrow: 'SAMPLE PROJECT BRIEF', title: 'Start with the project evidence.', copy: 'This is an illustrative approval-stage workflow, not a real project record.', bullets: ['Review the published notice and the stage it supports.', 'Check which organisations are named in the evidence.', 'Treat timing and equipment needs as questions to verify.'], href: '/#platform/projects', cta: 'Explore current projects' },
    maintenance: { eyebrow: 'SAMPLE MAINTENANCE BRIEF', title: 'Read the notice in context.', copy: 'This sample shows how a published maintenance signal could be investigated.', bullets: ['Read the described work and source publication context.', 'Check whether dates and scope are explicit or still uncertain.', 'Confirm the actual requirement through your commercial process.'], href: '/#platform/opportunities', cta: 'Explore current opportunities' },
    equipment: { eyebrow: 'PREDICTED · SAMPLE EQUIPMENT BRIEF', title: 'An inference to investigate.', copy: 'Equipment relevance is PREDICTED from work context. This sample is not a confirmed hire requirement.', bullets: ['Review the described activity behind the prediction.', 'Inspect the equipment class and the evidence supporting it.', 'Confirm specification, quantity, timing and availability before acting.'], href: '/#platform/equipment-demand', cta: 'Explore equipment demand' },
    evidence: { eyebrow: 'SAMPLE EVIDENCE TRAIL', title: 'Keep the source within reach.', copy: 'This is a sample explanation of the evidence workflow. No source publication is claimed for this fictional example.', bullets: ['Production records should point to retained public-source evidence.', 'Review the publication context and collection status.', 'If a source is unavailable or deferred, keep that limitation visible.'], href: '/#platform/source-admin', cta: 'Review current source health' },
    outcome: { eyebrow: 'SAMPLE COMMERCIAL WORKFLOW', title: 'Record what actually happened.', copy: 'This example explains the next step. It does not represent a completed sales activity or commercial result.', bullets: ['Investigate the project and verify relevant organisations.', 'Enter the real result of your own commercial activity.', 'Link the outcome to the project without assuming a hire or contract.'], href: '/#platform/crm', cta: 'Explore the CRM workflow' },
  };
  const demoDialog = document.querySelector('#demo-dialog');
  const detailDialog = document.querySelector('#detail-dialog');
  let lastDialogTrigger = null;
  function openDialog(dialog, trigger) {
    if (!dialog) return;
    lastDialogTrigger = trigger;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
  }
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const demoTrigger = event.target.closest('[data-demo]');
    if (demoTrigger) {
      const status = document.querySelector('.demo-status');
      if (status) status.textContent = '';
      openDialog(demoDialog, demoTrigger);
    }
    const detailTrigger = event.target.closest('[data-detail]');
    if (detailTrigger && detailDialog) {
      const detail = details[detailTrigger.dataset.detail] || details.evidence;
      detailDialog.querySelector('.detail-content').innerHTML = `<p class="eyebrow">${detail.eyebrow}</p><h2 id="detail-title">${detail.title}</h2><span class="sample-label">ILLUSTRATIVE CONTENT / NOT A LIVE RECORD</span><p>${detail.copy}</p><ul>${detail.bullets.map((bullet) => `<li>${bullet}</li>`).join('')}</ul><a class="button" href="${detail.href}">${detail.cta} <span aria-hidden="true">↗</span></a>`;
      openDialog(detailDialog, detailTrigger);
    }
    const closeButton = event.target.closest('[data-close]');
    if (closeButton) closeButton.closest('dialog')?.close();
  });
  document.querySelectorAll('dialog').forEach((dialog) => {
    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((element) => element.getClientRects().length);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    });
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
    dialog.addEventListener('close', () => {
      document.body.style.overflow = '';
      // Discard draft input on close; the preview retains no personal details.
      if (dialog === demoDialog) dialog.querySelector('form')?.reset();
      lastDialogTrigger?.focus();
    });
  });
  document.querySelector('.demo-preview-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    event.currentTarget.reset();
    document.querySelector('.demo-status').textContent = 'Preview complete. No request was sent and no details were stored. To make a real enquiry, use the current site’s contact page below.';
  });

  document.querySelectorAll('[data-brief-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      const filter = button.dataset.briefFilter;
      document.querySelectorAll('[data-brief-filter]').forEach((item) => {
        item.classList.toggle('active', item === button);
        item.setAttribute('aria-pressed', String(item === button));
      });
      let visible = 0;
      document.querySelectorAll('[data-brief]').forEach((card) => {
        card.hidden = filter !== 'all' && card.dataset.brief !== filter;
        if (!card.hidden) visible++;
      });
      document.querySelector('[data-brief-status]').textContent = `Showing ${visible} sample ${visible === 1 ? 'brief' : 'briefs'} for ${button.textContent}.`;
    });
  });

  const workspaceViews = {
    signals: { title: 'What deserves a closer look?', copy: 'Sample signals arranged for investigation.', label: 'PROJECT SIGNALS', rows: [['◎', 'Approval-stage project', 'Inspect the project stage and published context', 'SAMPLE SIGNAL', 'approval'], ['◷', 'Published maintenance activity', 'Review the described work and timing', 'SAMPLE SIGNAL', 'maintenance'], ['↗', 'Equipment relevance', 'An inference to verify against actual scope', 'PREDICTED', 'equipment']] },
    demand: { title: 'Which equipment may be relevant?', copy: 'Predicted classes are a planning input to verify.', label: 'PREDICTED · SAMPLE', rows: [['▱', 'Earthmoving', 'Sample groundworks context', 'PREDICTED', 'equipment'], ['↟', 'Access equipment', 'Sample elevated maintenance context', 'PREDICTED', 'equipment'], ['ϟ', 'Temporary power', 'Sample site operations context', 'PREDICTED', 'equipment']] },
    evidence: { title: 'What supports the signal?', copy: 'Read the source context before acting.', label: 'SAMPLE EVIDENCE', rows: [['▤', 'Published notice', 'Review what the evidence actually says', 'SOURCE CONTEXT', 'evidence'], ['◎', 'Project connection', 'Understand the link to the project record', 'PROVENANCE', 'approval'], ['↗', 'Collection status', 'Check availability and known limitations', 'SOURCE HEALTH', 'evidence']] },
  };
  function renderWorkspace(key) {
    const panel = document.querySelector('[data-workspace-panel]');
    if (!panel) return;
    const view = workspaceViews[key];
    panel.innerHTML = `<div class="console-heading"><div><h2>${view.title}</h2><p>${view.copy}</p></div><span class="console-subtle">${view.label}</span></div><div class="signal-rows">${view.rows.map(([icon, title, copy, tag, detail]) => `<article class="signal-row"><span class="signal-symbol" aria-hidden="true">${icon}</span><div><h3>${title}</h3><p>${copy}</p></div><span class="row-tag">${tag}</span><button data-detail="${detail}" aria-label="View sample detail: ${title}">↗</button></article>`).join('')}</div>`;
  }
  const regions = {
    WA: ['Western Australia', 'A resources-led planning conversation.', 'Illustrative focus: inspect resource-project stages, published maintenance activity and regional equipment questions.'],
    QLD: ['Queensland', 'Connect sector activity to your territory.', 'Illustrative focus: investigate civil, energy and resource project evidence before choosing a regional follow-up.'],
    NSW: ['New South Wales', 'Put infrastructure activity in context.', 'Illustrative focus: review civil, transport and development signals alongside project stage and delivery organisations.'],
  };
  function renderRegion(key) {
    const panel = document.querySelector('[data-region-panel]');
    if (!panel) return;
    const [region, title, copy] = regions[key];
    panel.innerHTML = `<p class="eyebrow">${region.toUpperCase()} / SAMPLE TERRITORY</p><h3>${title}</h3><p>${copy} This is not a statement of live regional coverage.</p><a class="text-link" href="/#platform/map">Open the platform map <span aria-hidden="true">↗</span></a>`;
    document.querySelectorAll('[data-map-dot]').forEach((dot) => dot.classList.toggle('active', dot.dataset.mapDot === key));
  }
  const equipment = {
    earthmoving: ['Earthmoving relevance', 'Groundworks described in a sample project notice may make earthmoving classes relevant.', 'Confirm excavation scope, site conditions, equipment specification and programme.'],
    access: ['Access relevance', 'Elevated work described in sample maintenance activity may make access classes relevant.', 'Confirm working height, reach, site constraints and the actual maintenance window.'],
    power: ['Power & lighting relevance', 'Temporary site operations described in a sample notice may make power or lighting classes relevant.', 'Confirm load, duration, connection availability and site operating requirements.'],
  };
  function renderEquipment(key) {
    const panel = document.querySelector('[data-equipment-panel]');
    if (!panel) return;
    const [title, basis, verify] = equipment[key];
    panel.innerHTML = `<div><p class="eyebrow">PREDICTED / SAMPLE ONLY</p><h3>${title}</h3><p>No confirmed equipment requirement.</p></div><div><h4>Why it may be relevant</h4><p>${basis}</p></div><div><h4>What to verify next</h4><p>${verify}</p><button class="text-link" data-detail="equipment">Inspect the reasoning <span aria-hidden="true">↗</span></button></div>`;
  }
  const workflows = {
    source: { label: '01 / SOURCE CONTEXT', title: 'Begin with what is published.', copy: 'Read the notice, its publication context and the activity it supports. Keep open questions visible.', rows: [['Record', 'Illustrative project notice'], ['Evidence', 'Sample only — no live source'], ['Next step', 'Verify stage and scope']], detail: 'evidence', action: 'How evidence is handled' },
    context: { label: '02 / PROJECT CONTEXT', title: 'Make the connections explicit.', copy: 'Review the project stage and named organisations. Equipment relevance remains a prediction to investigate.', rows: [['Project stage', 'To verify against evidence'], ['Organisations', 'Only where supported'], ['Equipment relevance', 'PREDICTED · Sample only']], detail: 'equipment', action: 'How predictions are handled' },
    outcome: { label: '03 / COMMERCIAL OUTCOME', title: 'Let real activity complete the picture.', copy: 'Record the result of your team’s work against the project. A sample workflow is never presented as a sales result.', rows: [['Outcome source', 'Human-entered activity'], ['Current sample status', 'No activity recorded'], ['Next step', 'Verify, act, then record']], detail: 'outcome', action: 'How outcomes are handled' },
  };
  function renderWorkflow(key) {
    const panel = document.querySelector('[data-workflow-panel]');
    if (!panel) return;
    const view = workflows[key];
    panel.innerHTML = `<div><p class="eyebrow">${view.label}</p><h3>${view.title}</h3><p>${view.copy}</p></div><div class="sample-record">${view.rows.map(([label, value]) => `<div class="record-line"><span>${label}</span><strong>${value}</strong></div>`).join('')}<button class="text-link" data-detail="${view.detail}">${view.action} <span aria-hidden="true">↗</span></button></div>`;
  }
  function bindChoice(attribute, render) {
    const buttons = document.querySelectorAll(`[${attribute}]`);
    buttons.forEach((button) => button.addEventListener('click', () => {
      buttons.forEach((item) => {
        item.classList.toggle('active', item === button);
        item.setAttribute('aria-pressed', String(item === button));
      });
      render(button.getAttribute(attribute));
    }));
  }
  bindChoice('data-workspace-tab', renderWorkspace);
  bindChoice('data-region', renderRegion);
  bindChoice('data-equipment', renderEquipment);
  bindChoice('data-workflow', renderWorkflow);
  renderWorkspace('signals');
  renderRegion('WA');
  renderEquipment('earthmoving');
  renderWorkflow('source');
})();
