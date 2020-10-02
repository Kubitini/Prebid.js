## Overview

```
Module Name: Stroeer Bidder Adapter
Module Type: Bidder Adapter
Maintainer: help@cz.stroeer-labs.com
```


## Ad unit configuration for publishers

```javascript
const adUnits = [{ 
    code: 'div-gpt-ad-1460505748561-0',
    sizes: [[728, 90],[987, 123],[770, 250],[800, 250]], // TODO
    bids: [{
        bidder: 'stroeerCore',
        params: {
          sid: "83891"
        }    
    }]
},{
    code: 'div-gpt-ad-1460505661639-0',
    sizes: [[770, 250]],
    bids: [{
      bidder: 'stroeerCore',
      params: {
        sid: "85929"
      }    
    }]
}];
```
### Config Notes

* Slot id (`sid`) is required. The adapter will ignore bid requests from prebid if `sid` is not provided. This must be in the decoded form. For example, "1234" as opposed to "MTM0ODA=". 
* The server ignores dimensions that are not supported by the slot or by the platform (such as 987x123).
