import React, { useRef, forwardRef, useImperativeHandle } from 'react';
import { View, StyleSheet } from 'react-native';
import WebView from 'react-native-webview';

// Leaflet map via WebView — no Google Maps API key needed
// Exposes: updateDriver(lat, lng), updateWaypoints(wps), updateRoute(coords), fitRoute(coords)

const MAP_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body,#map{width:100%;height:100%;background:#1e293b}
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = L.map('map',{zoomControl:false,attributionControl:false}).setView([52.237,21.017],12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);

    var driverMarker=null, waypointMarkers=[], routeLine=null;

    function mkDriverIcon(){
      return L.divIcon({
        className:'',
        html:'<div style="width:16px;height:16px;border-radius:50%;background:#3b82f6;border:3px solid #fff;box-shadow:0 0 6px rgba(0,0,0,.5)"></div>',
        iconSize:[16,16],iconAnchor:[8,8]
      });
    }

    function updateDriver(lat,lng){
      var ll=[lat,lng];
      if(driverMarker){ driverMarker.setLatLng(ll); }
      else { driverMarker=L.marker(ll,{icon:mkDriverIcon(),zIndexOffset:1000}).addTo(map); }
    }

    function updateWaypoints(wps){
      waypointMarkers.forEach(function(m){map.removeLayer(m)});
      waypointMarkers=[];
      wps.forEach(function(wp,i){
        var isLast=i===wps.length-1;
        var icon=L.divIcon({
          className:'',
          html:'<div style="width:14px;height:14px;border-radius:50%;background:'+(isLast?'#ef4444':'#f59e0b')+';border:2px solid #fff"></div>',
          iconSize:[14,14],iconAnchor:[7,7]
        });
        var m=L.marker([wp.lat,wp.lng],{icon:icon}).addTo(map);
        if(wp.label) m.bindPopup(wp.label);
        waypointMarkers.push(m);
      });
    }

    function updateRoute(coords){
      if(routeLine){map.removeLayer(routeLine);routeLine=null;}
      if(!coords||!coords.length) return;
      var lls=coords.map(function(c){return[c.latitude,c.longitude]});
      routeLine=L.polyline(lls,{color:'#3b82f6',weight:5,opacity:0.85}).addTo(map);
    }

    function fitRoute(coords){
      if(!coords||!coords.length) return;
      var lls=coords.map(function(c){return[c.latitude,c.longitude]});
      map.fitBounds(L.latLngBounds(lls),{padding:[40,40],maxZoom:16,animate:true});
    }

    function panTo(lat,lng,zoom){
      map.setView([lat,lng],zoom||map.getZoom(),{animate:true});
    }

    window.addEventListener('message',function(e){
      try{
        var msg=JSON.parse(e.data);
        if(msg.t==='driver') updateDriver(msg.lat,msg.lng);
        else if(msg.t==='waypoints') updateWaypoints(msg.wps);
        else if(msg.t==='route') updateRoute(msg.coords);
        else if(msg.t==='fit') fitRoute(msg.coords);
        else if(msg.t==='pan') panTo(msg.lat,msg.lng,msg.zoom);
      }catch(err){}
    });
  </script>
</body>
</html>`;

const LeafletMap = forwardRef(function LeafletMap({ style }, ref) {
  const webViewRef = useRef(null);

  function send(obj) {
    const js = `(function(){
      window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(JSON.stringify(obj))}}));
    })(); true;`;
    webViewRef.current?.injectJavaScript(js);
  }

  useImperativeHandle(ref, () => ({
    updateDriver(lat, lng) { send({ t: 'driver', lat, lng }); },
    updateWaypoints(wps) { send({ t: 'waypoints', wps }); },
    updateRoute(coords) { send({ t: 'route', coords }); },
    fitRoute(coords) { send({ t: 'fit', coords }); },
    panTo(lat, lng, zoom) { send({ t: 'pan', lat, lng, zoom }); },
  }));

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={webViewRef}
        source={{ html: MAP_HTML }}
        style={styles.webview}
        javaScriptEnabled
        originWhitelist={['*']}
        scrollEnabled={false}
        bounces={false}
      />
    </View>
  );
});

export default LeafletMap;

const styles = StyleSheet.create({
  container: { overflow: 'hidden' },
  webview: { flex: 1, backgroundColor: '#1e293b' },
});
