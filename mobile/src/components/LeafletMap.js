import React, { useRef, forwardRef, useImperativeHandle, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import WebView from 'react-native-webview';
import { LEAFLET_MAP_HTML, MAP_METHODS } from './leafletMapHtml';

// Native implementation — WebView, calls delivered with injectJavaScript.
// The ref exposes every function listed in MAP_METHODS.

const LeafletMap = forwardRef(function LeafletMap({ style, onMapMessage }, ref) {
  const webViewRef = useRef(null);
  const readyRef = useRef(false);
  const queueRef = useRef([]);
  const handlerRef = useRef(onMapMessage);
  handlerRef.current = onMapMessage;

  const onMessage = useCallback((event) => {
    const data = event.nativeEvent.data;
    if (data === 'ready') {
      readyRef.current = true;
      queueRef.current.splice(0).forEach((js) => webViewRef.current?.injectJavaScript(js));
      return;
    }
    try {
      const msg = JSON.parse(data);
      if (msg?.t) handlerRef.current?.(msg);
    } catch {}
  }, []);

  useImperativeHandle(ref, () => {
    const api = {};
    for (const fn of MAP_METHODS) {
      api[fn] = (...args) => {
        const js = `window.__call(${JSON.stringify(fn)},${JSON.stringify(args)});true;`;
        if (readyRef.current) webViewRef.current?.injectJavaScript(js);
        else queueRef.current.push(js);
      };
    }
    return api;
  }, []);

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={webViewRef}
        source={{ html: LEAFLET_MAP_HTML }}
        style={styles.webview}
        javaScriptEnabled
        originWhitelist={['*']}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        onMessage={onMessage}
      />
    </View>
  );
});

export default LeafletMap;

const styles = StyleSheet.create({
  container: { overflow: 'hidden', backgroundColor: '#0d0f14' },
  webview: { flex: 1, backgroundColor: '#0d0f14' },
});
