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

  function sendWithGtag(eventName, params) {
    params = params || {};
    params.send_to = MEASUREMENT_ID;

    if (!gtagReady) {
      outboundQueue.push({ eventName: eventName, params: params });
      return;
    }
    window.gtag('event', eventName, params);
    log('[SST forward] gtag("event", %o, %o)', eventName, params);
  }

  function flushOutboundQueue() {
    gtagReady = true;
    if (!outboundQueue.length) return;
    for (var i = 0; i < outboundQueue.length; i++) {
      var e = outboundQueue[i];
      window.gtag('event', e.eventName, e.params);
      log('[SST forward][flush] gtag("event", %o, %o)', e.eventName, e.params);
    }
    outboundQueue = [];
  }

  function forwardEventObject(obj) {
    if (!obj || !obj.event) return;
    var eventName = String(obj.event || '').trim();
    if (!eventName || shouldBlockEventName(eventName)) return;

    var params = splitAndBundleParams(obj);
    sendWithGtag(eventName, params);
  }

    dl.push = function () {
        var result = originalPush.apply(dl, arguments);

        for (var i = 0; i < arguments.length; i++) {
      var data = arguments[i];

            if (data && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, 'event')) {
        forwardEventObject(data);
      }
    }

    return result;
  };

    try {
    for (var i = 0; i < dl.length; i++) {
      var entry = dl[i];
            if (entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'event')) {
        forwardEventObject(entry);
      }
    }
  } catch (_) { }

    loadGtagAndConfigure().then(flushOutboundQueue);

})(window, document);
