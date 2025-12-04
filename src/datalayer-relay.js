/******************************
 *  SST (Server-Side Tagging) Relay Script
 *
 *  This script intercepts dataLayer pushes and relays ONLY events
 *  (pushes with an 'event' property) to a server-side GTM container.
 *
 ******************************/

(function (window, document) {
  'use strict';

  /******************************
   *  CONFIG — EDIT THESE
   ******************************/
  var MEASUREMENT_ID = '{{GA4_PROPERTY}}';
  var SERVER_CONTAINER_URL = '{{SERVER_CONTAINER_URL}}';
  var LOAD_GTAG_FROM_SST = true;
  var DEBUG = true;

  var BLOCKED_EVENT_PREFIXES = ['gtm.', 'js'];
  var PARAM_DENYLIST = [
    'send_to', 'eventCallback', 'eventTimeout',
    'gtm.uniqueEventId', 'gtm.start', 'gtm.element', 'gtm.elementText', 'gtm.elementId'
  ];
  var PARAM_DENY_PREFIXES = ['gtm'];

  var COMMON_GTAG_PARAMS = [
    'page_location', 'page_referrer', 'page_title', 'link_url', 'link_domain',
    'engagement_time_msec', 'debug_mode', 'non_interaction', 'user_id', 'session_id',
    'campaign', 'source', 'medium', 'term', 'content', 'gclid', 'dclid',
    'transaction_id', 'value', 'currency', 'tax', 'shipping', 'affiliation',
    'coupon', 'payment_type', 'shipping_tier', 'method', 'items',
    'item_list_name', 'item_list_id', 'creative_name', 'creative_slot',
    'location_id', 'item_category', 'item_category2', 'item_category3',
    'item_category4', 'item_category5', 'item_id', 'item_name',
    'search_term', 'content_type', 'content_id', 'video_title',
    'video_url', 'video_provider'
  ];

  var BUNDLED_PARAM_NAME = 'datalayer';
  var PERSISTENT_FIELDS = [];
  var RELAY_DATALAYER_NAME = 'relayDL';
  var RELAY_VERSION = 'v2.3-' + new Date().toISOString();

  var USE_IDLE_CALLBACK = true;

  // Convert COMMON_GTAG_PARAMS array to object for fast lookups
  var COMMON_GTAG_PARAM_KEYS = {};
  for (var i = 0; i < COMMON_GTAG_PARAMS.length; i++) {
    COMMON_GTAG_PARAM_KEYS[COMMON_GTAG_PARAMS[i]] = true;
  }

  /******************************
   *  HELPER FUNCTIONS
   ******************************/
  function log() {
    if (DEBUG && typeof console !== 'undefined') {
      console.log.apply(console, arguments);
    }
  }

  function startsWithAny(str, prefixes) {
    if (!str || !prefixes || !prefixes.length) return false;
    for (var i = 0; i < prefixes.length; i++) {
      if (str.indexOf(prefixes[i]) === 0) return true;
    }
    return false;
  }

  function shouldBlockEventName(eventName) {
    return startsWithAny(String(eventName || ''), BLOCKED_EVENT_PREFIXES);
  }

  function shouldDropParamKey(key) {
    return PARAM_DENYLIST.indexOf(key) > -1 || startsWithAny(key, PARAM_DENY_PREFIXES);
  }

  function safeStringify(obj) {
    var seen = [];
    return JSON.stringify(obj, function (key, value) {
      if (typeof value === 'object' && value !== null) {
        if (seen.indexOf(value) !== -1) return '[Circular]';
        seen.push(value);
      }
      return value;
    });
  }

  function normalizeParamValue(val) {
    if (val === null || val === undefined) return val;
    var t = typeof val;
    if (t === 'string' || t === 'number' || t === 'boolean') return val;
    try { return safeStringify(val); } catch (e) { return String(val); }
  }

  function isEmptyValue(val) {
    return val === null || val === undefined || val === '';
  }

  function scheduleCallback(fn) {
    if (USE_IDLE_CALLBACK && typeof requestIdleCallback === 'function') {
      requestIdleCallback(fn);
    } else {
      fn();
    }
  }

  /******************************
   *  GTAG INITIALIZATION
   ******************************/
  var gtagOverrideAttempts = [];
  var currentGtag = null;
  var ownGtagScriptUrl = null;

  function isFromOwnGtagScript(stack) {
    if (!ownGtagScriptUrl || !stack) return false;
    // Check if the stack contains our gtag.js URL
    return stack.indexOf(ownGtagScriptUrl) !== -1;
  }

  function initializeGtag() {
    // Initialize custom dataLayer for gtag
    window[RELAY_DATALAYER_NAME] = window[RELAY_DATALAYER_NAME] || [];

    // Create our initial gtag function (queue-based)
    currentGtag = function() {
      window[RELAY_DATALAYER_NAME].push(arguments);
    };

    // Build our gtag.js URL for later comparison
    var idParam = 'id=' + encodeURIComponent(MEASUREMENT_ID);
    var layerParam = '&l=' + encodeURIComponent(RELAY_DATALAYER_NAME);
    ownGtagScriptUrl = (LOAD_GTAG_FROM_SST && SERVER_CONTAINER_URL)
      ? SERVER_CONTAINER_URL.replace(/\/+$/, '') + '/gtag/js?' + idParam + layerParam
      : 'https://www.googletagmanager.com/gtag/js?' + idParam + layerParam;

    // Monitor window.gtag with defineProperty
    try {
      Object.defineProperty(window, 'gtag', {
        get: function() {
          return currentGtag;
        },
        set: function(newValue) {
          var stack = new Error().stack || 'Stack not available';
          var isFromOwn = isFromOwnGtagScript(stack);

          var attemptInfo = {
            timestamp: new Date().toISOString(),
            newValueType: typeof newValue,
            newValueString: String(newValue).substring(0, 200),
            stack: stack,
            accepted: isFromOwn,
            source: isFromOwn ? 'own-gtag-script' : 'external'
          };
          gtagOverrideAttempts.push(attemptInfo);

          if (isFromOwn) {
            // Accept override from our own gtag.js script
            currentGtag = newValue;
            log(
              '%c[GTAG OVERRIDE ACCEPTED]%c From our gtag.js script',
              'background: #28a745; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
              'color: #28a745;'
            );
          } else {
            // Log but accept external overrides too (so gtag still works)
            // but keep track that it happened
            console.warn(
              '%c[GTAG OVERRIDE DETECTED]%c External script tried to set window.gtag',
              'background: #ff9800; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
              'color: #ff9800; font-weight: bold;'
            );
            console.warn('New value:', newValue);
            console.warn('Stack trace:', stack);
            console.log('Override attempts so far:', gtagOverrideAttempts);

            // Still accept it so things don't break, but we've logged it
            currentGtag = newValue;
          }
        },
        configurable: false,
        enumerable: true
      });
      log('[Gtag Monitor] window.gtag is now being monitored for overrides');
      log('[Gtag Monitor] Own script URL:', ownGtagScriptUrl);
    } catch (e) {
      // Fallback if defineProperty fails
      window.gtag = currentGtag;
      console.warn('[Gtag Monitor] Could not monitor window.gtag:', e);
    }

    // Configure gtag immediately (gtag has built-in queueing)
    window.gtag('js', new Date());
    window.gtag('config', MEASUREMENT_ID, {
      send_page_view: false,
      transport_url: SERVER_CONTAINER_URL ? SERVER_CONTAINER_URL.replace(/\/+$/, '') : undefined
    });

    // Load gtag.js script
    var script = document.createElement('script');
    script.async = true;
    script.src = ownGtagScriptUrl;
    document.head.appendChild(script);
  }

  /******************************
   *  PERSISTENCE
   ******************************/
  var persistentState = {};

  function updatePersistentState(obj) {
    if (!PERSISTENT_FIELDS.length) return;

    for (var i = 0; i < PERSISTENT_FIELDS.length; i++) {
      var fieldName = PERSISTENT_FIELDS[i];
      if (Object.prototype.hasOwnProperty.call(obj, fieldName)) {
        var value = obj[fieldName];
        if (!isEmptyValue(value)) {
          persistentState[fieldName] = value;
          log('[Persistence] Updated %o = %o', fieldName, value);
        } else {
          delete persistentState[fieldName];
          log('[Persistence] Cleared %o (empty value)', fieldName);
        }
      }
    }
  }

  function mergeWithPersistentState(obj) {
    if (!PERSISTENT_FIELDS.length || !Object.keys(persistentState).length) {
      return obj;
    }

    // Create merged object: persistent state + current event
    var merged = {};
    for (var key in persistentState) {
      merged[key] = persistentState[key];
    }
    for (var key in obj) {
      merged[key] = obj[key];
    }
    return merged;
  }

  /******************************
   *  PARAMETER PROCESSING
   ******************************/
  function splitAndBundleParams(sourceObj) {
    var topLevel = {};
    var bundle = {};

    for (var key in sourceObj) {
      if (key === 'event') continue;
      if (shouldDropParamKey(key)) continue;

      var val = sourceObj[key];
      if (COMMON_GTAG_PARAM_KEYS[key]) {
        topLevel[key] = normalizeParamValue(val);
      } else {
        bundle[key] = val;
      }
    }

    if (Object.keys(bundle).length) {
      topLevel[BUNDLED_PARAM_NAME] = safeStringify(bundle);
    }
    return topLevel;
  }

  /******************************
   *  EVENT PROCESSING
   ******************************/
  var eventStats = {
    processed: 0,
    sent: 0,
    blocked: 0
  };

  function sendEvent(eventName, params) {
    params.send_to = MEASUREMENT_ID;
    scheduleCallback(function() {
      window.gtag('event', eventName, params);
      eventStats.sent++;
      log('[SST forward] (#%o) gtag("event", %o, %o)', eventStats.sent, eventName, params);
    });
  }

  function processDataLayerObject(obj) {
    if (!obj || typeof obj !== 'object') return;

    // Update persistent state from any dataLayer push
    updatePersistentState(obj);

    // Only forward objects with an event property
    if (!Object.prototype.hasOwnProperty.call(obj, 'event')) {
      log('[SST process] Data-only push (no event property)');
      return;
    }

    eventStats.processed++;
    var eventName = String(obj.event || '').trim();

    // Block filtered events
    if (!eventName || shouldBlockEventName(eventName)) {
      eventStats.blocked++;
      log('[SST blocked] Event blocked: %o', eventName);
      return;
    }

    log('[SST process] Processing event #%o: %o', eventStats.processed, eventName);

    // Merge with persistent state and send
    var mergedObj = mergeWithPersistentState(obj);
    var params = splitAndBundleParams(mergedObj);
    sendEvent(eventName, params);
  }

  /******************************
   *  DATALAYER INTERCEPTION
   ******************************/
  var dl = window.dataLayer = window.dataLayer || [];
  var originalPush = dl.push.bind(dl);

  // Intercept dataLayer.push
  dl.push = function () {
    // Process and relay events BEFORE adding to dataLayer
    for (var i = 0; i < arguments.length; i++) {
      if (arguments[i] && typeof arguments[i] === 'object') {
        processDataLayerObject(arguments[i]);
      }
    }
    // Then add to dataLayer for other listeners
    var result = originalPush.apply(dl, arguments);
    return result;
  };

  // Process existing dataLayer entries
  try {
    for (var i = 0; i < dl.length; i++) {
      if (dl[i] && typeof dl[i] === 'object') {
        processDataLayerObject(dl[i]);
      }
    }
  } catch (_) {}

  /******************************
   *  INITIALIZATION
   ******************************/
  log('========================================');
  log('   DataLayer Relay Script Loaded');
  log('   Version:', RELAY_VERSION);
  log('   App DataLayer: window.dataLayer');
  log('   Gtag DataLayer: window.' + RELAY_DATALAYER_NAME);
  log('   Persistent Fields:', PERSISTENT_FIELDS.length ? PERSISTENT_FIELDS : 'None');
  log('   Idle Callback:', USE_IDLE_CALLBACK ? 'ON' : 'OFF');
  log('   Debug Mode:', DEBUG ? 'ON' : 'OFF');
  log('========================================');

  scheduleCallback(initializeGtag);

  /******************************
   *  DEBUG UTILITIES
   ******************************/
  window.dataLayerRelayVersion = RELAY_VERSION;
  window.dataLayerRelayStats = function() {
    console.log('========================================');
    console.log('   DataLayer Relay Statistics');
    console.log('   Version:', RELAY_VERSION);
    console.log('----------------------------------------');
    console.log('   Processed:', eventStats.processed, '(events with event property)');
    console.log('   Blocked:', eventStats.blocked, '(filtered events)');
    console.log('   Sent:', eventStats.sent, '(forwarded to SST)');
    console.log('----------------------------------------');
    console.log('   Persistent state:', persistentState);
    console.log('========================================');
    return eventStats;
  };

  window.dataLayerRelayGtagOverrides = function() {
    console.log('========================================');
    console.log('   Gtag Override Attempts');
    console.log('========================================');
    console.log('   Own gtag.js URL:', ownGtagScriptUrl);
    console.log('----------------------------------------');
    if (gtagOverrideAttempts.length === 0) {
      console.log('   No override attempts detected');
    } else {
      var ownCount = gtagOverrideAttempts.filter(function(a) { return a.accepted; }).length;
      var externalCount = gtagOverrideAttempts.length - ownCount;
      console.log('   Total attempts:', gtagOverrideAttempts.length);
      console.log('   From own script:', ownCount);
      console.log('   From external:', externalCount);
      console.log('----------------------------------------');
      gtagOverrideAttempts.forEach(function(attempt, index) {
        var sourceLabel = attempt.accepted ? '✅ OWN' : '⚠️  EXTERNAL';
        console.log('   Attempt #' + (index + 1) + ' [' + sourceLabel + ']:');
        console.log('     Time:', attempt.timestamp);
        console.log('     Source:', attempt.source);
        console.log('     Type:', attempt.newValueType);
        console.log('     Value:', attempt.newValueString);
        console.log('     Stack:', attempt.stack);
        console.log('');
      });
    }
    console.log('========================================');
    return gtagOverrideAttempts;
  };

})(window, document);
