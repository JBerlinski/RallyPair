import React, { useRef, forwardRef, useImperativeHandle, useEffect } from 'react';
import { LEAFLET_MAP_HTML } from './leafletMapHtml';

// Web implementation — <iframe srcDoc> + postMessage
// Metro picks this file on web; LeafletMap.js (WebView) is used on native

const LeafletMap = forwardRef(function LeafletMap({ style }, ref) {
  const iframeRef = useRef(null);
  const readyRef = useRef(false);
  const queueRef = useRef([]);

  useEffect(() => {
    const handler = (event) => {
      if (event.data === 'ready') {
        readyRef.current = true;
        const pending = queueRef.current.splice(0);
        pending.forEach((msg) => {
          iframeRef.current?.contentWindow?.postMessage(msg, '*');
        });
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  function send(obj) {
    const msg = JSON.stringify(obj);
    if (readyRef.current) {
      iframeRef.current?.contentWindow?.postMessage(msg, '*');
    } else {
      queueRef.current.push(msg);
    }
  }

  useImperativeHandle(ref, () => ({
    updateDriver(lat, lng, heading) { send({ t: 'driver', lat, lng, heading: heading ?? null }); },
    updateWaypoints(wps)            { send({ t: 'waypoints', wps }); },
    updateRoute(coords)             { send({ t: 'route', coords }); },
    fitRoute(coords)                { send({ t: 'fit', coords }); },
    panTo(lat, lng, zoom)           { send({ t: 'pan', lat, lng, zoom: zoom ?? null }); },
    setBearing(deg)                 { send({ t: 'bearing', deg }); },
    setTileUrl(url)                 { send({ t: 'tile', url }); },
  }));

  const containerStyle = {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    backgroundColor: '#1e293b',
    ...(style || {}),
  };

  return (
    <div style={containerStyle}>
      <iframe
        ref={iframeRef}
        srcDoc={LEAFLET_MAP_HTML}
        title="map"
        style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
        sandbox="allow-scripts allow-same-origin"
      />
    </div>
  );
});

export default LeafletMap;
