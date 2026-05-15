// Shared Leaflet HTML used by:
//   native  → WebView (functions called via injectJavaScript)
//   web     → <iframe srcDoc> (functions called via postMessage)

export const LEAFLET_MAP_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="https://unpkg.com/leaflet-rotate@0.2.8/dist/leaflet-rotate-src.js"></script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body,#map{width:100%;height:100%;background:#1e293b}
    #compass{
      width:40px;height:40px;
      background:rgba(15,23,42,0.85);
      border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      cursor:pointer;
      box-shadow:0 2px 6px rgba(0,0,0,0.4);
      margin-bottom:8px;
      transition:transform 0.25s ease;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = L.map('map',{
      rotate: true,
      bearing: 0,
      zoomControl: false,
      attributionControl: false
    }).setView([52.237,21.017],12);

    var tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
    var driverMarker=null, waypointMarkers=[], routeLine=null;
    var currentBearing = 0;

    // Compass control
    var CompassControl = L.Control.extend({
      options: { position: 'bottomright' },
      onAdd: function() {
        var div = L.DomUtil.create('div');
        div.id = 'compass';
        div.innerHTML = '<svg id="compass-svg" width="22" height="22" viewBox="0 0 22 22">'
          + '<polygon points="11,2 13.5,10 11,8.5 8.5,10" fill="#ef4444"/>'
          + '<polygon points="11,20 13.5,12 11,13.5 8.5,12" fill="#64748b"/>'
          + '</svg>';
        L.DomEvent.on(div,'click',L.DomEvent.stopPropagation);
        L.DomEvent.on(div,'click',function(){ setBearing(0); });
        return div;
      }
    });
    new CompassControl().addTo(map);

    function mkDriverIcon(heading){
      var hasHdg = heading != null && !isNaN(heading) && heading >= 0;
      if(hasHdg){
        var rot = Math.round(heading);
        var html = '<div style="transform:rotate('+rot+'deg);transform-origin:center;width:32px;height:32px">'
          +'<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">'
          +'<circle cx="16" cy="16" r="14" fill="rgba(59,130,246,0.22)" stroke="rgba(255,255,255,0.35)" stroke-width="1"/>'
          +'<polygon points="16,3 23,25 16,20 9,25" fill="#3b82f6" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>'
          +'</svg></div>';
        return L.divIcon({className:'',html:html,iconSize:[32,32],iconAnchor:[16,16]});
      }
      var dot = '<div style="width:16px;height:16px;border-radius:50%;background:#3b82f6;border:3px solid #fff;box-shadow:0 0 6px rgba(0,0,0,.5)"></div>';
      return L.divIcon({className:'',html:dot,iconSize:[16,16],iconAnchor:[8,8]});
    }

    function updateDriver(lat,lng,heading){
      var ll=[lat,lng];
      var icon=mkDriverIcon(heading);
      if(driverMarker){
        driverMarker.setLatLng(ll);
        driverMarker.setIcon(icon);
      } else {
        driverMarker=L.marker(ll,{icon:icon,zIndexOffset:1000}).addTo(map);
      }
    }

    function setBearing(deg){
      currentBearing = deg;
      try{ if(map.setBearing) map.setBearing(deg); }catch(e){}
      var svg = document.getElementById('compass-svg');
      if(svg) svg.style.transform = 'rotate('+(-deg)+'deg)';
    }

    function setTileUrl(url){
      map.removeLayer(tileLayer);
      tileLayer=L.tileLayer(url,{maxZoom:19}).addTo(map);
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
      if(wps.length>0) map.setView([wps[0].lat,wps[0].lng],13,{animate:true});
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

    // Handle postMessage from parent (web iframe) or injectJavaScript (native WebView)
    window.addEventListener('message',function(e){
      try{
        var msg=JSON.parse(e.data);
        if(msg.t==='driver')    updateDriver(msg.lat,msg.lng,msg.heading);
        else if(msg.t==='waypoints') updateWaypoints(msg.wps);
        else if(msg.t==='route')     updateRoute(msg.coords);
        else if(msg.t==='fit')       fitRoute(msg.coords);
        else if(msg.t==='pan')       panTo(msg.lat,msg.lng,msg.zoom);
        else if(msg.t==='bearing')   setBearing(msg.deg);
        else if(msg.t==='tile')      setTileUrl(msg.url);
      }catch(err){}
    });

    // Signal readiness — works for both React Native WebView and browser iframe parent
    try{
      if(window.ReactNativeWebView){ window.ReactNativeWebView.postMessage('ready'); }
      else if(window.parent && window.parent!==window){ window.parent.postMessage('ready','*'); }
    }catch(e){}
  </script>
</body>
</html>`;
