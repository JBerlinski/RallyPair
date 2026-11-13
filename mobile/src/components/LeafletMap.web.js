import React, { useRef, forwardRef, useImperativeHandle, useEffect } from 'react';
import { LEAFLET_MAP_HTML, MAP_METHODS } from './leafletMapHtml';

// Web implementation — <iframe srcDoc>, calls delivered with postMessage.
// The ref exposes every function listed in MAP_METHODS.

const LeafletMap = forwardRef(function LeafletMap({ style, onMapMessage }, ref) {
  const iframeRef = useRef(null);
  const readyRef = useRef(false);
  const queueRef = useRef([]);
  const handlerRef = useRef(onMapMessage);
  handlerRef.current = onMapMessage;

  useEffect(() => {
    const handler = (event) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data === 'ready') {
        readyRef.current = true;
        queueRef.current.splice(0).forEach((m) => iframeRef.current?.contentWindow?.postMessage(m, '*'));
        return;
      }
      try {
        const msg = JSON.parse(event.data);
        if (msg?.t) handlerRef.current?.(msg);
      } catch {}
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  useImperativeHandle(ref, () => {
    const api = {};
    for (const fn of MAP_METHODS) {
      api[fn] = (...args) => {
        const msg = JSON.stringify({ fn, args });
        if (readyRef.current) iframeRef.current?.contentWindow?.postMessage(msg, '*');
        else queueRef.current.push(msg);
      };
    }
    return api;
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden', backgroundColor: '#0d0f14', ...(style || {}) }}>
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
