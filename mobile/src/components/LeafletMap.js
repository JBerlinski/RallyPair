import React, { useRef, forwardRef, useImperativeHandle, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import WebView from 'react-native-webview';
import { LEAFLET_MAP_HTML } from './leafletMapHtml';

// Native implementation — WebView + injectJavaScript for direct function calls
// Messages queued until WebView signals 'ready' via ReactNativeWebView.postMessage

const LeafletMap = forwardRef(function LeafletMap({ style }, ref) {
  const webViewRef = useRef(null);
  const readyRef = useRef(false);
  const queueRef = useRef([]);

  const exec = useCallback((jsCode) => {
    const full = jsCode + '; true;';
    if (readyRef.current) {
      webViewRef.current?.injectJavaScript(full);
    } else {
      queueRef.current.push(full);
    }
  }, []);

  const onMessage = useCallback((event) => {
    if (event.nativeEvent.data === 'ready') {
      readyRef.current = true;
      const pending = queueRef.current.splice(0);
      pending.forEach((js) => webViewRef.current?.injectJavaScript(js));
    }
  }, []);

  useImperativeHandle(ref, () => ({
    updateDriver(lat, lng, heading) {
      const h = heading != null ? heading : 'undefined';
      exec(`updateDriver(${lat},${lng},${h})`);
    },
    updateWaypoints(wps) { exec(`updateWaypoints(${JSON.stringify(wps)})`); },
    updateRoute(coords)  { exec(`updateRoute(${JSON.stringify(coords)})`); },
    fitRoute(coords)     { exec(`fitRoute(${JSON.stringify(coords)})`); },
    panTo(lat, lng, zoom){ exec(`panTo(${lat},${lng},${zoom != null ? zoom : 'undefined'})`); },
    setBearing(deg)      { exec(`setBearing(${deg})`); },
    setTileUrl(url)      { exec(`setTileUrl(${JSON.stringify(url)})`); },
  }), [exec]);

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
        onMessage={onMessage}
      />
    </View>
  );
});

export default LeafletMap;

const styles = StyleSheet.create({
  container: { overflow: 'hidden' },
  webview: { flex: 1, backgroundColor: '#1e293b' },
});
