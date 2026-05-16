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
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = L.map('map',{
      rotate:true, bearing:0, zoomControl:false, attributionControl:false,
      touchRotate:true, touchGestures:true
    }).setView([52.237,21.017],12);

    var tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
    var driverMarker=null, waypointMarkers=[], routeLine=null;
    var editingIndex=-1, editingOriginalLL=null;

    // Send a message back to the React host (native WebView or web iframe parent)
    function sendToReact(obj){
      var data=JSON.stringify(obj);
      try{
        if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(data);
        else if(window.parent&&window.parent!==window) window.parent.postMessage(data,'*');
      }catch(e){}
    }

    function mkDriverIcon(heading){
      var hasHdg=heading!=null&&!isNaN(heading)&&heading>=0;
      if(hasHdg){
        var rot=Math.round(heading);
        var html='<div style="transform:rotate('+rot+'deg);transform-origin:center;width:32px;height:32px">'
          +'<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">'
          +'<circle cx="16" cy="16" r="14" fill="rgba(59,130,246,0.22)" stroke="rgba(255,255,255,0.35)" stroke-width="1"/>'
          +'<polygon points="16,3 23,25 16,20 9,25" fill="#3b82f6" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>'
          +'</svg></div>';
        return L.divIcon({className:'',html:html,iconSize:[32,32],iconAnchor:[16,16]});
      }
      var dot='<div style="width:16px;height:16px;border-radius:50%;background:#3b82f6;border:3px solid #fff;box-shadow:0 0 6px rgba(0,0,0,.5)"></div>';
      return L.divIcon({className:'',html:dot,iconSize:[16,16],iconAnchor:[8,8]});
    }

    function mkWaypointIcon(isLast,editing){
      if(editing){
        return L.divIcon({
          className:'',
          html:'<div style="width:20px;height:20px;border-radius:50%;background:#a855f7;border:3px solid #fff;box-shadow:0 0 10px rgba(168,85,247,0.7)"></div>',
          iconSize:[20,20],iconAnchor:[10,10]
        });
      }
      return L.divIcon({
        className:'',
        html:'<div style="width:14px;height:14px;border-radius:50%;background:'+(isLast?'#ef4444':'#f59e0b')+';border:2px solid #fff"></div>',
        iconSize:[14,14],iconAnchor:[7,7]
      });
    }

    function updateDriver(lat,lng,heading){
      var ll=[lat,lng];
      var icon=mkDriverIcon(heading);
      if(driverMarker){ driverMarker.setLatLng(ll); driverMarker.setIcon(icon); }
      else { driverMarker=L.marker(ll,{icon:icon,zIndexOffset:1000}).addTo(map); }
    }

    function setBearing(deg){
      try{if(map.setBearing)map.setBearing(deg);}catch(e){}
    }

    var navTiltActive=false;
    function setNavTilt(enable){
      navTiltActive=!!enable;
      var el=document.getElementById('map');
      if(navTiltActive){
        el.style.transformOrigin='50% 100%';
        el.style.transform='perspective(500px) rotateX(40deg)';
      }else{
        el.style.transformOrigin='';
        el.style.transform='';
      }
      try{map.invalidateSize({animate:false});}catch(e){}
    }

    function setTileUrl(url){
      map.removeLayer(tileLayer);
      tileLayer=L.tileLayer(url,{maxZoom:19}).addTo(map);
    }

    function updateWaypoints(wps){
      waypointMarkers.forEach(function(m){map.removeLayer(m)});
      waypointMarkers=[];
      editingIndex=-1; editingOriginalLL=null;
      wps.forEach(function(wp,i){
        var isLast=i===wps.length-1;
        var m=L.marker([wp.lat,wp.lng],{
          icon:mkWaypointIcon(isLast,false),
          draggable:true,
          zIndexOffset:500
        }).addTo(map);
        m.dragging.disable();
        if(wp.label) m.bindTooltip(wp.label,{permanent:false,direction:'top'});
        // Click on marker → open context menu in React
        (function(idx){
          m.on('click',function(e){
            L.DomEvent.stopPropagation(e);
            sendToReact({t:'waypointClick',index:idx});
          });
        })(i);
        waypointMarkers.push(m);
      });
      if(wps.length>0) map.setView([wps[0].lat,wps[0].lng],13,{animate:true});
    }

    function editWaypoint(index){
      var marker=waypointMarkers[index];
      if(!marker)return;
      editingIndex=index;
      editingOriginalLL=marker.getLatLng();
      marker.setIcon(mkWaypointIcon(index===waypointMarkers.length-1,true));
      marker.dragging.enable();
      marker.on('dragend',function(){
        var ll=marker.getLatLng();
        sendToReact({t:'waypointMoved',index:index,lat:ll.lat,lng:ll.lng});
      });
    }

    function cancelEditWaypoint(){
      if(editingIndex<0)return;
      var marker=waypointMarkers[editingIndex];
      if(marker){
        if(editingOriginalLL)marker.setLatLng(editingOriginalLL);
        marker.dragging.disable();
        marker.off('dragend');
        marker.setIcon(mkWaypointIcon(editingIndex===waypointMarkers.length-1,false));
      }
      editingIndex=-1; editingOriginalLL=null;
    }

    function confirmEditWaypoint(){
      if(editingIndex<0)return;
      var marker=waypointMarkers[editingIndex];
      if(marker){
        marker.dragging.disable();
        marker.off('dragend');
        marker.setIcon(mkWaypointIcon(editingIndex===waypointMarkers.length-1,false));
      }
      editingIndex=-1; editingOriginalLL=null;
    }

    function updateRoute(coords){
      if(routeLine){map.removeLayer(routeLine);routeLine=null;}
      if(!coords||!coords.length)return;
      var lls=coords.map(function(c){return[c.latitude,c.longitude]});
      routeLine=L.polyline(lls,{color:'#3b82f6',weight:5,opacity:0.85}).addTo(map);
    }

    function fitRoute(coords){
      if(!coords||!coords.length)return;
      var lls=coords.map(function(c){return[c.latitude,c.longitude]});
      map.fitBounds(L.latLngBounds(lls),{padding:[40,40],maxZoom:16,animate:true});
    }

    function panTo(lat,lng,zoom){
      map.setView([lat,lng],zoom||map.getZoom(),{animate:true});
    }

    window.addEventListener('message',function(e){
      try{
        var msg=JSON.parse(e.data);
        if(msg.t==='driver')         updateDriver(msg.lat,msg.lng,msg.heading);
        else if(msg.t==='waypoints') updateWaypoints(msg.wps);
        else if(msg.t==='route')     updateRoute(msg.coords);
        else if(msg.t==='fit')       fitRoute(msg.coords);
        else if(msg.t==='pan')       panTo(msg.lat,msg.lng,msg.zoom);
        else if(msg.t==='bearing')   setBearing(msg.deg);
        else if(msg.t==='tile')      setTileUrl(msg.url);
        else if(msg.t==='editWp')    editWaypoint(msg.index);
        else if(msg.t==='cancelEdit')cancelEditWaypoint();
        else if(msg.t==='confirmEdit')confirmEditWaypoint();
        else if(msg.t==='navTilt')   setNavTilt(msg.enable);
      }catch(err){}
    });

    // Signal readiness
    try{
      if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage('ready');
      else if(window.parent&&window.parent!==window) window.parent.postMessage('ready','*');
    }catch(e){}
  </script>
</body>
</html>`;
