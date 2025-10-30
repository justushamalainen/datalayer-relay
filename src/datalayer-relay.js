/******************************
 *  PRE-CONFIGURED FOR LOCAL TESTING
 *
 *  This file is a pre-configured version of datalayer-relay.js
 *  set up for local development and testing with:
 *  - Local server-side container (http://localhost:8080)
 *  - Debug mode enabled for console logging
 *  - gtag.js loaded from local SST container
 *
 *  Do not use this in production. Use datalayer-relay.js instead.
 ******************************/

(function (window, document) {
  'use strict';

  /******************************
   *  SST (Server-Side Tagging) Relay Script
   *
   *  This script intercepts dataLayer pushes and relays ONLY events
   *  (pushes with an 'event' property) to a server-side GTM container.
   *
   ******************************/

  /******************************
   *  CONFIG — EDIT THESE
   ******************************/
  var MEASUREMENT_ID = '{{GA4_PROPERTY}}';

  var SERVER_CONTAINER_URL = '{{SERVER_CONTAINER_URL}}';

  var LOAD_GTAG_FROM_SST = true;

    var BLOCKED_EVENT_PREFIXES = ['gtm.', 'js'];

  var PARAM_DENYLIST = [
    'send_to',
    'eventCallback', 'eventTimeout',
    'gtm.uniqueEventId', 'gtm.start', 'gtm.element', 'gtm.elementText', 'gtm.elementId'
  ];

    var PARAM_DENY_PREFIXES = [
    'gtm',       ];

  var COMMON_GTAG_PARAM_KEYS = {
        'page_location': true, 'page_referrer': true, 'page_title': true, 'link_url': true, 'link_domain': true,
    'engagement_time_msec': true, 'debug_mode': true, 'non_interaction': true, 'user_id': true, 'session_id': true,
        'campaign': true, 'source': true, 'medium': true, 'term': true, 'content': true, 'gclid': true, 'dclid': true,
        'transaction_id': true, 'value': true, 'currency': true, 'tax': true, 'shipping': true, 'affiliation': true,
    'coupon': true, 'payment_type': true, 'shipping_tier': true, 'method': true, 'items': true,
    'item_list_name': true, 'item_list_id': true, 'creative_name': true, 'creative_slot': true,
    'location_id': true, 'item_category': true, 'item_category2': true, 'item_category3': true,
    'item_category4': true, 'item_category5': true, 'item_id': true, 'item_name': true,
        'search_term': true, 'content_type': true, 'content_id': true, 'video_title': true,
    'video_url': true, 'video_provider': true
  };

  var BUNDLED_PARAM_NAME = 'datalayer';

  var DEBUG = true;

  // Array of field names that should persist across all events
  // If an event sets any of these fields, the value will be sent with all subsequent events
  // Example: ['user_type', 'subscription_tier', 'session_info']
  // To enable, edit this array directly: var PERSISTENT_FIELDS = ['field1', 'field2'];
  var PERSISTENT_FIELDS = [];

  // Delay in milliseconds between processing each dataLayer push
  // This helps prevent overwhelming the system when many events are replayed quickly
  var PROCESSING_DELAY_MS = 500;

  // Version/build identifier for debugging
  var RELAY_VERSION = 'v2.0-' + new Date().toISOString();

  function log() { if (DEBUG && typeof console !== 'undefined') console.log.apply(console, arguments); }

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
    if (PARAM_DENYLIST.indexOf(key) > -1) return true;
    return startsWithAny(key, PARAM_DENY_PREFIXES);
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


  function loadGtagAndConfigure() {
    return new Promise(function (resolve) {
      function finishConfig() {
        try {
                    window.gtag('js', new Date());

                    var cfg = { send_page_view: false };
          if (SERVER_CONTAINER_URL) {
            var base = SERVER_CONTAINER_URL.replace(/\/+$/, '');
            cfg.transport_url = base;
          }

          window.gtag('config', MEASUREMENT_ID, cfg);
          resolve();
        } catch (e) {
          resolve();
        }
      }

      if (typeof window.gtag === 'function') {
        finishConfig();
        return;
      }

      window.dataLayer = window.dataLayer || [];
      window.gtag = function(){ window.dataLayer.push(arguments); };

      var script = document.createElement('script');
      script.async = true;
      script.src = (LOAD_GTAG_FROM_SST && SERVER_CONTAINER_URL)
        ? SERVER_CONTAINER_URL.replace(/\/+$/, '') + '/gtag/js?id=' + encodeURIComponent(MEASUREMENT_ID)
        : 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(MEASUREMENT_ID);
      script.onload = finishConfig;
      script.onerror = finishConfig;
      document.head.appendChild(script);
    });
  }


  var dl = window.dataLayer = window.dataLayer || [];
  var originalPush = dl.push.bind(dl);

  function splitAndBundleParams(sourceObj) {
    var topLevel = Object.create(null);
    var bundle = Object.create(null);

    Object.keys(sourceObj).forEach(function (key) {
      if (key === 'event') return;
      if (shouldDropParamKey(key)) return;

      var val = sourceObj[key];
      if (COMMON_GTAG_PARAM_KEYS[key]) {
        topLevel[key] = normalizeParamValue(val);
      } else {
        bundle[key] = val;
      }
    });

    if (Object.keys(bundle).length) {
      topLevel[BUNDLED_PARAM_NAME] = safeStringify(bundle);
    }
    return topLevel;
  }

  var outboundQueue = [];
  var gtagReady = false;

  // Storage for persistent field values that should be included in all events
  var persistentState = {};

  // Event counters for debugging
  var eventStats = {
    processed: 0,
    queued: 0,
    sent: 0,
    blocked: 0
  };

  // Track cumulative delay for staggered event processing
  var cumulativeDelay = 0;

  function sendWithGtag(eventName, params) {
    params = params || {};
    params.send_to = MEASUREMENT_ID;

    if (!gtagReady) {
      outboundQueue.push({ eventName: eventName, params: params });
      eventStats.queued++;
      log('[SST queued] Event queued (total: %o): %o', outboundQueue.length, eventName);
      return;
    }
    window.gtag('event', eventName, params);
    eventStats.sent++;
    log('[SST forward] (#%o sent) gtag("event", %o, %o)', eventStats.sent, eventName, params);
  }

  function flushOutboundQueue() {
    gtagReady = true;
    if (!outboundQueue.length) {
      log('[SST flush] No events in queue');
      return;
    }
    log('[SST flush] Flushing %o queued events...', outboundQueue.length);
    for (var i = 0; i < outboundQueue.length; i++) {
      var e = outboundQueue[i];
      window.gtag('event', e.eventName, e.params);
      eventStats.sent++;
      log('[SST forward][flush] (#%o sent) gtag("event", %o, %o)', eventStats.sent, e.eventName, e.params);
    }
    outboundQueue = [];
    log('[SST flush] Complete. Stats: %o', eventStats);
  }

  // Update persistent state with values from the current event
  function updatePersistentState(obj) {
    if (!PERSISTENT_FIELDS || !PERSISTENT_FIELDS.length) return;

    for (var i = 0; i < PERSISTENT_FIELDS.length; i++) {
      var fieldName = PERSISTENT_FIELDS[i];
      if (Object.prototype.hasOwnProperty.call(obj, fieldName)) {
        var value = obj[fieldName];
        // Only store non-empty values
        if (!isEmptyValue(value)) {
          persistentState[fieldName] = value;
          log('[Persistence] Updated %o = %o', fieldName, value);
        } else {
          // If value is empty, remove it from persistent state
          if (Object.prototype.hasOwnProperty.call(persistentState, fieldName)) {
            delete persistentState[fieldName];
            log('[Persistence] Cleared %o (empty value)', fieldName);
          }
        }
      }
    }
  }

  // Check if a value is empty (null, undefined, empty string)
  function isEmptyValue(val) {
    return val === null || val === undefined || val === '';
  }

  // Create a merged object with persistent state and current event data
  function mergeWithPersistentState(obj) {
    if (!PERSISTENT_FIELDS || !PERSISTENT_FIELDS.length) return obj;
    if (!Object.keys(persistentState).length) return obj;

    // Create a new object with persistent state as base
    var merged = {};

    // First, add persistent state (but skip empty values)
    for (var key in persistentState) {
      if (Object.prototype.hasOwnProperty.call(persistentState, key)) {
        var value = persistentState[key];
        // Only include non-empty values
        if (!isEmptyValue(value)) {
          merged[key] = value;
        }
      }
    }

    // Then, overlay the current event data (which takes precedence)
    for (var key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        merged[key] = obj[key];
      }
    }

    return merged;
  }

  function processDataLayerObject(obj) {
    if (!obj || typeof obj !== 'object') return;

    // Always update persistent state from any dataLayer push (with or without event)
    updatePersistentState(obj);

    // Only forward if this object has an event property
    if (!Object.prototype.hasOwnProperty.call(obj, 'event')) {
      log('[SST process] Data-only push (no event property)');
      return;
    }

    eventStats.processed++;
    var eventName = String(obj.event || '').trim();

    if (!eventName || shouldBlockEventName(eventName)) {
      eventStats.blocked++;
      log('[SST blocked] Event blocked: %o (blocked: %o, processed: %o)', eventName, eventStats.blocked, eventStats.processed);
      return;
    }

    log('[SST process] Processing event: %o (processed: %o)', eventName, eventStats.processed);

    // Merge persistent state with current event (current event takes precedence)
    var mergedObj = mergeWithPersistentState(obj);

    // Process the merged object
    var params = splitAndBundleParams(mergedObj);
    sendWithGtag(eventName, params);
  }

    dl.push = function () {
        var result = originalPush.apply(dl, arguments);

        for (var i = 0; i < arguments.length; i++) {
      var data = arguments[i];

            // Process all objects (both with and without events)
            // This captures persistent fields from all dataLayer pushes
            if (data && typeof data === 'object') {
        // Delay processing to prevent overwhelming the system during bulk replays
        // Increment delay for each event to create staggered processing
        cumulativeDelay += PROCESSING_DELAY_MS;
        (function(obj, delay) {
          setTimeout(function() {
            processDataLayerObject(obj);
          }, delay);
        })(data, cumulativeDelay);
      }
    }

    return result;
  };

    try {
    for (var i = 0; i < dl.length; i++) {
      var entry = dl[i];
            // Process all existing entries (both with and without events)
            if (entry && typeof entry === 'object') {
        // Delay processing to prevent overwhelming the system
        (function(obj, index) {
          setTimeout(function() {
            processDataLayerObject(obj);
          }, index * PROCESSING_DELAY_MS);
        })(entry, i);
      }
    }
  } catch (_) { }

    // Log initialization with version info
  log('========================================');
  log('🚀 DataLayer Relay Script Loaded');
  log('   Version:', RELAY_VERSION);
  log('   Processing Delay:', PROCESSING_DELAY_MS + 'ms');
  log('   Persistent Fields:', PERSISTENT_FIELDS);
  log('   Debug Mode:', DEBUG ? 'ON' : 'OFF');
  log('========================================');

  loadGtagAndConfigure().then(flushOutboundQueue);

  // Expose version and stats for debugging in console
  window.dataLayerRelayVersion = RELAY_VERSION;

  window.dataLayerRelayStats = function() {
    console.log('========================================');
    console.log('📊 DataLayer Relay Statistics');
    console.log('   Version:', RELAY_VERSION);
    console.log('   Processing Delay:', PROCESSING_DELAY_MS + 'ms');
    console.log('   Cumulative Delay:', cumulativeDelay + 'ms');
    console.log('----------------------------------------');
    console.log('   Processed:', eventStats.processed, '(total events with event property)');
    console.log('   Blocked:', eventStats.blocked, '(filtered out by BLOCKED_EVENT_PREFIXES)');
    console.log('   Queued:', eventStats.queued, '(waiting for gtag to load)');
    console.log('   Sent:', eventStats.sent, '(forwarded to server-side GTM)');
    console.log('   Currently in queue:', outboundQueue.length);
    console.log('   gtag ready:', gtagReady);
    console.log('----------------------------------------');
    console.log('   Persistent state:', persistentState);
    console.log('========================================');
    return eventStats;
  };

})(window, document);
