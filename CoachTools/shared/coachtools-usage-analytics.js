(function attachCoachToolsUsageAnalytics(root) {
  'use strict';

  const VERSION = '1.0.0';
  const STATE_KEY = 'coachtools.usageAnalytics.private.v1';
  const FIREBASE_APP_URL = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js';
  const FIREBASE_FIRESTORE_URL = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js';
  const FIREBASE_CONFIG = Object.freeze({
    apiKey: 'AIzaSyDEpWQEzkA8TYzuJNqLEcZmFJOCYaeAryE',
    authDomain: 'myone3-visitors.firebaseapp.com',
    projectId: 'myone3-visitors',
    storageBucket: 'myone3-visitors.firebasestorage.app',
    messagingSenderId: '1000181582176',
    appId: '1:1000181582176:web:9a8b5ba5f9679ae3233605'
  });

  const runtime = {
    db: null,
    disabled: false,
    loading: false,
    ready: false,
    queue: [],
    flushing: false,
    pendingNewVisitor: false,
    pendingVisitDay: '',
    pendingApps: new Set()
  };

  function todayKey() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function randomAnonymousInitials() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const bytes = new Uint8Array(3);
    try { root.crypto.getRandomValues(bytes); }
    catch (_) {
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes, value => alphabet[value % alphabet.length]).join('');
  }

  function loadState() {
    try {
      const parsed = JSON.parse(root.localStorage.getItem(STATE_KEY) || 'null');
      if (parsed && typeof parsed === 'object') {
        return {
          anonymousInitials: /^[A-Z]{3}$/.test(String(parsed.anonymousInitials || '')) ? parsed.anonymousInitials : randomAnonymousInitials(),
          visitorRegistered: parsed.visitorRegistered === true,
          lastVisitDay: /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.lastVisitDay || '')) ? parsed.lastVisitDay : '',
          seenApps: parsed.seenApps && typeof parsed.seenApps === 'object' ? parsed.seenApps : {}
        };
      }
    } catch (_) {}
    return { anonymousInitials: randomAnonymousInitials(), visitorRegistered: false, lastVisitDay: '', seenApps: {} };
  }

  const localState = loadState();

  function saveState() {
    try { root.localStorage.setItem(STATE_KEY, JSON.stringify(localState)); } catch (_) {}
  }

  function safeId(value) {
    return String(value || 'unknown')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'unknown';
  }

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Analytics dependency unavailable.'));
      document.head.appendChild(script);
    });
  }

  async function ensureFirebase() {
    if (runtime.disabled || runtime.ready || runtime.loading) return;
    if (root.navigator && root.navigator.onLine === false) {
      runtime.disabled = true;
      runtime.queue.length = 0;
      return;
    }

    runtime.loading = true;
    try {
      if (!root.firebase || !root.firebase.initializeApp) await loadScript(FIREBASE_APP_URL);
      if (!root.firebase || !root.firebase.firestore) await loadScript(FIREBASE_FIRESTORE_URL);
      if (!root.firebase || !root.firebase.firestore) throw new Error('Firestore unavailable.');

      const app = root.firebase.apps && root.firebase.apps.length
        ? root.firebase.apps.find(item => item && item.options && item.options.projectId === FIREBASE_CONFIG.projectId)
          || root.firebase.initializeApp(FIREBASE_CONFIG, 'coachtools-usage-analytics')
        : root.firebase.initializeApp(FIREBASE_CONFIG, 'coachtools-usage-analytics');

      runtime.db = app.firestore();
      runtime.ready = true;
      flushQueue();
    } catch (_) {
      runtime.disabled = true;
      runtime.queue.length = 0;
    } finally {
      runtime.loading = false;
    }
  }

  function increment(value) {
    return root.firebase.firestore.FieldValue.increment(Number(value) || 0);
  }

  function enqueue(event) {
    if (!event || runtime.disabled) return;
    runtime.queue.push(event);
    if (runtime.ready) flushQueue();
  }

  function markFailure() {
    runtime.disabled = true;
    runtime.queue.length = 0;
    runtime.pendingNewVisitor = false;
    runtime.pendingVisitDay = '';
    runtime.pendingApps.clear();
  }

  async function writeSession(event) {
    const db = runtime.db;
    const batch = db.batch();
    const summary = db.collection('coachtoolsUsage').doc('summary');
    const daily = db.collection('coachtoolsUsageDaily').doc(event.day);
    const initials = db.collection('coachtoolsUsageInitials').doc(localState.anonymousInitials);

    const summaryData = { schemaVersion: 1, sessions: increment(1) };
    const dailyData = { date: event.day, sessions: increment(1) };
    if (event.newVisitor) summaryData.uniqueVisitors = increment(1);
    if (event.newDay) dailyData.uniqueVisitors = increment(1);

    batch.set(summary, summaryData, { merge: true });
    batch.set(daily, dailyData, { merge: true });
    batch.set(initials, { label: localState.anonymousInitials }, { merge: true });
    await batch.commit();

    if (event.newVisitor) localState.visitorRegistered = true;
    if (event.newDay) localState.lastVisitDay = event.day;
    saveState();
    if (event.newVisitor) runtime.pendingNewVisitor = false;
    if (runtime.pendingVisitDay === event.day) runtime.pendingVisitDay = '';
  }

  async function writeAppOpen(event) {
    const db = runtime.db;
    const batch = db.batch();
    const summary = db.collection('coachtoolsUsage').doc('summary');
    const daily = db.collection('coachtoolsUsageDaily').doc(event.day);
    const app = db.collection('coachtoolsUsageApps').doc(event.appId);
    const initials = db.collection('coachtoolsUsageInitials').doc(localState.anonymousInitials);

    batch.set(summary, { schemaVersion: 1, appOpenEvents: increment(1) }, { merge: true });
    batch.set(daily, { date: event.day, appOpenEvents: increment(1) }, { merge: true });
    batch.set(app, {
      appId: event.appId,
      name: event.appName || event.appId,
      opens: increment(1),
      ...(event.firstForVisitor ? { uniqueVisitors: increment(1) } : {})
    }, { merge: true });
    batch.set(initials, {
      label: localState.anonymousInitials,
      appOpenEvents: increment(1),
      ...(event.firstForVisitor ? { distinctApps: increment(1) } : {})
    }, { merge: true });
    await batch.commit();

    if (event.firstForVisitor) {
      localState.seenApps[event.appId] = true;
      runtime.pendingApps.delete(event.appId);
      saveState();
    }
  }

  async function writeUpload(event) {
    const db = runtime.db;
    const batch = db.batch();
    const summary = db.collection('coachtoolsUsage').doc('summary');
    const daily = db.collection('coachtoolsUsageDaily').doc(event.day);
    const initials = db.collection('coachtoolsUsageInitials').doc(localState.anonymousInitials);

    const values = { uploadActions: increment(1), filesUploaded: increment(event.fileCount) };
    batch.set(summary, { schemaVersion: 1, ...values }, { merge: true });
    batch.set(daily, { date: event.day, ...values }, { merge: true });
    batch.set(initials, { label: localState.anonymousInitials, ...values }, { merge: true });
    await batch.commit();
  }

  async function flushQueue() {
    if (!runtime.ready || runtime.disabled || runtime.flushing) return;
    runtime.flushing = true;
    try {
      while (runtime.queue.length && !runtime.disabled) {
        const event = runtime.queue.shift();
        try {
          if (event.type === 'session') await writeSession(event);
          else if (event.type === 'app-open') await writeAppOpen(event);
          else if (event.type === 'upload') await writeUpload(event);
        } catch (_) {
          markFailure();
        }
      }
    } finally {
      runtime.flushing = false;
    }
  }

  function trackSession() {
    const day = todayKey();
    const newVisitor = !localState.visitorRegistered && !runtime.pendingNewVisitor;
    const newDay = localState.lastVisitDay !== day && runtime.pendingVisitDay !== day;
    if (newVisitor) runtime.pendingNewVisitor = true;
    if (newDay) runtime.pendingVisitDay = day;
    enqueue({ type: 'session', day, newVisitor, newDay });
  }

  function appNameFor(appId) {
    try {
      const manifest = root.COACHTOOLS_MANIFEST;
      const match = manifest && Array.isArray(manifest.apps) ? manifest.apps.find(app => app && app.id === appId) : null;
      return match && match.name ? String(match.name).slice(0, 100) : appId;
    } catch (_) {
      return appId;
    }
  }

  function trackAppOpen(appId, appName) {
    const id = safeId(appId);
    if (!id || id === 'unknown') return;
    const firstForVisitor = !localState.seenApps[id] && !runtime.pendingApps.has(id);
    if (firstForVisitor) runtime.pendingApps.add(id);
    enqueue({
      type: 'app-open',
      day: todayKey(),
      appId: id,
      appName: String(appName || appNameFor(id) || id).slice(0, 100),
      firstForVisitor
    });
  }

  function trackUpload(fileCount) {
    const count = Math.max(1, Math.min(1000, Number(fileCount) || 1));
    enqueue({ type: 'upload', day: todayKey(), fileCount: count });
  }

  function attachDomTracking() {
    const windowLayer = document.getElementById('windowLayer');
    if (windowLayer && root.MutationObserver) {
      const seenNodes = new WeakSet();
      const inspect = node => {
        if (!(node instanceof Element)) return;
        const panes = [];
        if (node.matches && node.matches('.window-pane[data-app-id]')) panes.push(node);
        if (node.querySelectorAll) panes.push(...node.querySelectorAll('.window-pane[data-app-id]'));
        for (const pane of panes) {
          if (seenNodes.has(pane)) continue;
          seenNodes.add(pane);
          trackAppOpen(pane.dataset.appId);
        }
      };
      for (const pane of windowLayer.querySelectorAll('.window-pane[data-app-id]')) inspect(pane);
      new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) inspect(node);
      }).observe(windowLayer, { childList: true, subtree: true });
    }

    const quickDataInput = document.getElementById('quickDataInput');
    if (quickDataInput) {
      quickDataInput.addEventListener('change', event => {
        const files = event && event.target && event.target.files;
        if (files && files.length) trackUpload(files.length);
      }, { capture: true });
    }
  }

  function start() {
    attachDomTracking();
    trackSession();
    const beginFirebase = () => { ensureFirebase(); };
    if (typeof root.requestIdleCallback === 'function') root.requestIdleCallback(beginFirebase, { timeout: 2000 });
    else root.setTimeout(beginFirebase, 250);
  }

  root.CoachToolsUsageAnalytics = Object.freeze({
    version: VERSION,
    trackAppOpen,
    trackUpload,
    anonymousInitials: () => localState.anonymousInitials,
    status: () => ({ ready: runtime.ready, disabled: runtime.disabled, queued: runtime.queue.length })
  });

  if (document.readyState === 'complete') start();
  else root.addEventListener('load', start, { once: true });
})(window);
