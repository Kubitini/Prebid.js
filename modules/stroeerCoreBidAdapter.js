import {registerBidder} from '../src/adapters/bidderFactory.js';
import {ajax} from '../src/ajax.js';
import {BANNER} from '../src/mediaTypes.js';
import * as utils from '../src/utils.js';

// Do not import POLYFILLS from core-js. Most likely until next major update (v4).
// Prebid.js committers updated core-js to version 3 on v3.19.0 release (9/5/2020).
// This broke imports. We need to be backwards compatible since this adapter is copied into
// other prebids that may be older than the latest version. Try use alternative
// implementation or put polyfill directly at the end of this file as we did for 'find' function.
// import find from 'core-js-pure/features/array/find.js';

const BIDDER_CODE = 'stroeerCore';
const DEFAULT_HOST = 'hb.adscale.de';
const DEFAULT_PATH = '/dsh';
const DEFAULT_PORT = '';

const isSecureWindow = () => utils.getWindowSelf().location.protocol === 'https:';
const isMainPageAccessible = () => getMostAccessibleTopWindow() === utils.getWindowTop();

function getTopWindowReferrer() {
  try {
    return utils.getWindowTop().document.referrer;
  } catch (e) {
    return utils.getWindowSelf().referrer;
  }
}

function getMostAccessibleTopWindow() {
  let res = utils.getWindowSelf();

  try {
    while (utils.getWindowTop().top !== res && res.parent.location.href.length) {
      res = res.parent;
    }
  } catch (ignore) {
  }

  return res;
}

function elementInView(elementId) {
  const resolveElement = (elId) => {
    const win = utils.getWindowSelf();

    return win.document.getElementById(elId);
  };

  const visibleInWindow = (el, win) => {
    const rect = el.getBoundingClientRect();
    const inView = (rect.top + rect.height >= 0) && (rect.top <= win.innerHeight);

    if (win !== win.parent) {
      return inView && visibleInWindow(win.frameElement, win.parent);
    }

    return inView;
  };

  try {
    return visibleInWindow(resolveElement(elementId), utils.getWindowSelf());
  } catch (e) {
    // old browser, element not found, cross-origin etc.
  }
  return undefined;
}

function buildUrl({host: hostname = DEFAULT_HOST, port = DEFAULT_PORT, securePort, path: pathname = DEFAULT_PATH}) {
  if (securePort) {
    port = securePort;
  }

  return utils.buildUrl({protocol: 'https', hostname, port, pathname});
}

export const spec = {
  code: BIDDER_CODE,
  supportedMediaTypes: [BANNER],

  isBidRequestValid: (function () {
    const validators = [];

    const createValidator = (checkFn, errorMsgFn) => {
      return (bidRequest) => {
        if (checkFn(bidRequest)) {
          return true;
        } else {
          utils.logError(`invalid bid: ${errorMsgFn(bidRequest)}`, 'ERROR');
          return false;
        }
      }
    };

    function isBanner(bidReq) {
      return (!bidReq.mediaTypes && !bidReq.mediaType) ||
        (bidReq.mediaTypes && bidReq.mediaTypes.banner) ||
        bidReq.mediaType === BANNER;
    }

    validators.push(createValidator((bidReq) => isBanner(bidReq),
      bidReq => `bid request ${bidReq.bidId} is not a banner`));
    validators.push(createValidator((bidReq) => typeof bidReq.params === 'object',
      bidReq => `bid request ${bidReq.bidId} does not have custom params`));
    validators.push(createValidator((bidReq) => utils.isStr(bidReq.params.sid),
      bidReq => `bid request ${bidReq.bidId} does not have a sid string field`));
    validators.push(createValidator((bidReq) => bidReq.params.ssat === undefined || [1, 2].indexOf(bidReq.params.ssat) > -1,
      bidReq => `bid request ${bidReq.bidId} does not have a valid ssat value (must be 1 or 2)`));

    return function (bidRequest) {
      return validators.every(f => f(bidRequest));
    }
  }()),

  buildRequests: function (validBidRequests = [], bidderRequest) {
    const anyBid = bidderRequest.bids[0];

    const bidRequestWithSsat = find(validBidRequests, bidRequest => bidRequest.params.ssat);
    const bidRequestWithYl2 = find(validBidRequests, bidRequest => bidRequest.params.yl2);

    const payload = {
      id: bidderRequest.auctionId,
      bids: [],
      ref: getTopWindowReferrer(),
      ssl: isSecureWindow(),
      mpa: isMainPageAccessible(),
      timeout: bidderRequest.timeout - (Date.now() - bidderRequest.auctionStart),
      ssat: bidRequestWithSsat ? bidRequestWithSsat.params.ssat : 2, // TODO
      yl2: bidRequestWithYl2 ? bidRequestWithYl2.params.yl2 : (localStorage.sdgYieldtest === '1'), // TODO
      ab: utils.getWindowSelf()['yieldlove_ab'] // TODO
    };

    const userIds = anyBid.userId;

    if (!utils.isEmpty(userIds)) {
      payload.user = {
        euids: userIds
      };
    }

    const gdprConsent = bidderRequest.gdprConsent;

    if (gdprConsent && gdprConsent.consentString != null && gdprConsent.gdprApplies != null) {
      payload.gdpr = {
        consent: bidderRequest.gdprConsent.consentString, applies: bidderRequest.gdprConsent.gdprApplies
      };
    }

    function bidSizes(bid) {
      return utils.deepAccess(bid, 'mediaTypes.banner.sizes') || bid.sizes /* for prebid < 3 */ || [];
    }

    validBidRequests.forEach(bid => {
      payload.bids.push({
        bid: bid.bidId, sid: bid.params.sid, siz: bidSizes(bid), viz: elementInView(bid.adUnitCode)
      });
    });

    return {
      method: 'POST', url: buildUrl(anyBid.params), data: payload
    }
  },

  interpretResponse: function (serverResponse) {
    const bids = [];

    if (serverResponse.body && typeof serverResponse.body === 'object') {
      // TODO: do we need this ajax call?
      if (serverResponse.body.tep) {
        ajax(serverResponse.body.tep, () => {
        });
      }

      serverResponse.body.bids.forEach(bidResponse => {
        const cpm = bidResponse.cpm || 0;

        const bid = {
          // Prebid fields
          requestId: bidResponse.bidId,
          cpm: cpm,
          width: bidResponse.width || 0,
          height: bidResponse.height || 0,
          ad: bidResponse.ad,
          ttl: 300 /* 5 minutes */,
          currency: 'EUR',
          netRevenue: true,
          creativeId: '',
        };

        if (bidResponse.bidPriceOptimisation) {
          bids.push(Object.assign(bid, bidResponse.bidPriceOptimisation))
        } else {
          bids.push(bid);
        }
      });
    }

    return bids;
  },

  getUserSyncs: function (syncOptions, serverResponses) {
    if (serverResponses.length > 0 && syncOptions.iframeEnabled) {
      return [{
        type: 'iframe',
        url: 'https://js.adscale.de/pbsync.html'
      }];
    }

    return [];
  }
};

registerBidder(spec);

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/find#Polyfill
function find(obj, predicate) {
  // 1. Let O be ? ToObject(this value).
  var o = Object(obj);

  // 2. Let len be ? ToLength(? Get(O, "length")).
  var len = o.length >>> 0;

  // 3. If IsCallable(predicate) is false, throw a TypeError exception.
  if (typeof predicate !== 'function') {
    throw TypeError('predicate must be a function');
  }

  // 4. If thisArg was supplied, let T be thisArg; else let T be undefined.
  var thisArg = arguments[1];

  // 5. Let k be 0.
  var k = 0;

  // 6. Repeat, while k < len
  while (k < len) {
    // a. Let Pk be ! ToString(k).
    // b. Let kValue be ? Get(O, Pk).
    // c. Let testResult be ToBoolean(? Call(predicate, T, « kValue, k, O »)).
    // d. If testResult is true, return kValue.
    var kValue = o[k];
    if (predicate.call(thisArg, kValue, k, o)) {
      return kValue;
    }
    // e. Increase k by 1.
    k++;
  }

  // 7. Return undefined.
  return undefined;
}
