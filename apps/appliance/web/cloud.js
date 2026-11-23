'use strict';

(() => {
  const mode = document.currentScript.dataset.page;
  let session;
  let hindi = {};
  let catalog;
  const root = document.documentElement;

  function preference(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch { /* Preferences still work until this window closes. */ }
  }

  const languageKey = 'courtplus.uiLanguage';
  function display(text) {
    return root.lang === 'hi' && Object.hasOwn(hindi, text) ? hindi[text] : text;
  }

  function applyLanguage(language, render) {
    const selected = language === 'hi' ? 'hi' : 'en';
    if (root.lang !== selected) root.lang = selected;
    if (root.lang === 'en') { render(); return; }
    catalog ??= fetch('/cloud-hi.json').then(response => {
      if (!response.ok) throw new Error('Hindi catalog unavailable');
      return response.json();
    }).then(value => { hindi = value; }).catch(() => { catalog = undefined; });
    void catalog.then(render);
  }

  function standalonePreferences() {
    const main = document.querySelector('main');
    if (!main) return;
    // These nodes come from the signed-out and handoff page templates at startup.
    // Preserve the original text for switching back and leave input values and case data alone.
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    const strings = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent.trim()) strings.push([node, node.textContent]);
    }
    const controls = document.createElement('div');
    controls.className = 'cloud-preferences';
    const label = document.createElement('label');
    const labelText = document.createElement('span');
    const languages = document.createElement('select');
    languages.add(new Option('English', 'en'));
    languages.add(new Option('हिन्दी', 'hi'));
    label.append(labelText, languages);
    controls.append(label);
    main.prepend(controls);

    function render() {
      for (const [node, original] of strings) {
        const trimmed = original.trim();
        node.textContent = original.replace(trimmed, () => display(trimmed));
      }
      labelText.textContent = display('App language');
      languages.value = root.lang;
      document.dispatchEvent(new Event('courtplus:language'));
    }
    languages.addEventListener('change', () => {
      preference(languageKey, languages.value);
      applyLanguage(languages.value, render);
    });
    render();
    applyLanguage(preference(languageKey), render);
  }

  if (mode === 'login' || mode === 'home' || mode === 'handoffs') standalonePreferences();
  const methods = [
    'listPersons', 'listCases', 'importOrder', 'saveCase', 'screen', 'board', 'updateCard',
    'exportDraft', 'exportScReturn', 'verify', 'stats', 'role',
  ];
  const writes = new Set(['saveCase', 'updateCard', 'exportDraft', 'exportScReturn']);
  const labels = { release_order: 'Release order', bail_granted: 'Bail grant', acquitted: 'Acquittal' };

  async function request(path, options = {}) {
    const response = await fetch(path, { credentials: 'same-origin', ...options });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401 && mode !== 'login') location.replace('/login');
      const message = {
        INVALID_CREDENTIALS: 'Check your account and password.',
        IMPORT_ORDER_ON_DESKTOP: 'Import original orders in CourtPlus Desktop.',
        AI_ASSISTANCE_NOTE_ON_DESKTOP: 'Export AI assistance notes in CourtPlus Desktop.',
        EXPORT_WORKSPACE_UNAVAILABLE: 'The export package is unavailable on this server.',
        DRAFT_SIGNER_UNCONFIGURED: 'The server has no draft signing key configured.',
        DRAFT_OFFICE_UNCONFIGURED: 'The prison or district for this draft has not been configured.',
        FORBIDDEN: 'Your account cannot perform this action.',
      }[payload.error];
      throw new Error(message || (response.status === 429 ? 'Try again in a minute.' : 'Request failed (' + response.status + ').'));
    }
    if (response.status !== 204) return response.json();
  }

  function currentSession() {
    return session ??= request('/api/auth/session');
  }

  async function post(path, body, write = true) {
    const headers = { 'content-type': 'application/json' };
    if (write) headers['x-csrf-token'] = (await currentSession()).csrfToken;
    return request(path, { method: 'POST', headers, body: JSON.stringify(body) });
  }

  function encode(value) {
    if (value instanceof Uint8Array) {
      let text = '';
      for (let offset = 0; offset < value.length; offset += 8192) {
        text += String.fromCharCode(...value.subarray(offset, offset + 8192));
      }
      return { $base64: btoa(text) };
    }
    if (Array.isArray(value)) return value.map(encode);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, encode(child)]));
    }
    return value;
  }

  function downloads(paths) {
    const region = document.getElementById('cloud-downloads');
    if (!region) return;
    region.replaceChildren();
    for (const path of paths) {
      const link = document.createElement('a');
      link.href = path;
      link.textContent = 'Download ' + path.split('/').at(-1);
      region.append(link, ' ');
    }
  }

  if (mode === 'app') {
    window.courtplus = Object.fromEntries(methods.map(method => [method, async (...args) => {
      if (method === 'importOrder') throw new Error('Import original orders in CourtPlus Desktop.');
      if (method === 'verify') {
        const { pdf, receipt, manifest } = args[0];
        const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', pdf));
        const pdfDigest = Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
        return post('/api/verify-digest', { pdfDigest, receipt, manifest }, false);
      }
      const result = await post('/api/' + method, args.map(encode), writes.has(method));
      if (method === 'exportDraft') downloads([result.pdfPath, result.receiptPath, result.manifestPath]);
      if (method === 'exportScReturn') downloads([result]);
      return result;
    }]));
    document.addEventListener('DOMContentLoaded', () => {
      const bar = document.createElement('nav');
      bar.setAttribute('aria-label', 'CourtPlus Cloud');
      bar.style.cssText = 'display:flex;gap:1rem;padding:.5rem 1rem;align-items:center';
      bar.innerHTML = '<a href="/handoffs">Live jail and DLSA handoffs</a> ' +
        '<button type="button" id="sign-out">Sign out</button> <span id="cloud-downloads" aria-live="polite"></span>';
      document.body.prepend(bar);
      const render = () => {
        bar.querySelector('a').textContent = display('Live jail and DLSA handoffs');
        bar.querySelector('button').textContent = display('Sign out');
      };
      new MutationObserver(() => applyLanguage(root.lang, render)).observe(root, { attributes: true, attributeFilter: ['lang'] });
      applyLanguage(preference(languageKey), render);
      signOut();
    });
  }

  function signOut() {
    const control = document.querySelector('#sign-out');
    control?.addEventListener('click', async () => {
      try {
        await post('/api/auth/logout', {});
        location.replace('/login');
      } catch (error) {
        control.textContent = error.message;
      }
    });
  }

  if (mode === 'login') {
    const form = document.querySelector('#sign-in');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const message = form.querySelector('[role=status]');
      try {
        await post('/api/auth/login', Object.fromEntries(new FormData(form)), false);
        location.replace('/');
      } catch (error) {
        message.textContent = display(error.message);
      }
    });
  }

  if (mode === 'home' || mode === 'handoffs') signOut();
  if (mode === 'handoffs') {
    const form = document.querySelector('#new-handoff');
    const status = document.querySelector('#handoff-status');
    const list = document.querySelector('#handoff-list');
    const seen = new Map();
    const timestamp = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

    currentSession().then(async ({ role }) => {
      function render() {
        list.replaceChildren();
        const orders = [...seen.values()].sort((a, b) =>
          (a.acknowledgedAt === null && a.escalatedAt !== null ? 0 : a.acknowledgedAt === null ? 1 : 2)
          - (b.acknowledgedAt === null && b.escalatedAt !== null ? 0 : b.acknowledgedAt === null ? 1 : 2)
          || b.postedAt - a.postedAt);
        for (const order of orders) {
          const row = document.createElement('li');
          const state = order.acknowledgedAt !== null
            ? display('Acknowledged') + ' ' + timestamp.format(order.acknowledgedAt)
            : order.escalatedAt !== null ? display('Overdue · escalated') : display('Awaiting acknowledgement');
          const text = document.createElement('p');
          text.textContent = display(labels[order.kind]) + ' · ' + order.caseId + ' · ' + order.orderOn + ' · ' + state;
          row.append(text);
          if (role === 'superintendent' && order.acknowledgedAt === null) {
            const ack = document.createElement('button');
            ack.textContent = display('Acknowledge receipt');
            ack.addEventListener('click', async () => {
              ack.disabled = true;
              try {
                await post('/api/handoff/' + order.id + '/ack', {});
              } catch (error) {
                status.textContent = error.message;
                ack.disabled = false;
              }
            });
            row.append(ack);
          }
          list.append(row);
        }
      }

      document.addEventListener('courtplus:language', render);
      const live = new EventSource('/api/handoff/stream');
      live.onopen = () => { status.textContent = display('Connected'); };
      live.onerror = () => {
        status.textContent = display('Connection lost. Reconnecting…');
        session = undefined;
        void currentSession().catch(() => {});
      };
      live.addEventListener('snapshot', event => {
        seen.clear();
        for (const order of JSON.parse(event.data)) seen.set(order.id, order);
        render();
      });
      for (const name of ['posted', 'overdue', 'acknowledged']) {
        live.addEventListener(name, event => {
          const order = JSON.parse(event.data);
          seen.set(order.id, order);
          render();
        });
      }

      if (role === 'dlsa' || role === 'superintendent') {
        const action = role === 'dlsa' ? form : document.querySelector('#application-filed');
        const cases = await post('/api/listCases', [], false);
        for (const record of cases) action.elements.caseId.add(new Option(record.id, record.id));
        action.hidden = false;
        action.addEventListener('submit', async event => {
          event.preventDefault();
          const fields = Object.fromEntries(new FormData(action));
          try {
            if (role === 'dlsa') {
              await post('/api/handoff', fields);
              status.textContent = display('Handoff sent.');
            } else {
              await post('/api/cases/' + encodeURIComponent(fields.caseId) + '/application-filed', { filedOn: fields.filedOn });
              status.textContent = display('Application filing recorded.');
            }
          } catch (error) {
            status.textContent = error.message;
          }
        });
      }
    }).catch(error => { status.textContent = error.message; });
  }
})();
