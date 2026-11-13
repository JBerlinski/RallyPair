// Shared Leaflet page used by:
//   native → WebView   (calls arrive through injectJavaScript → window.__call)
//   web    → <iframe>  (calls arrive through postMessage)
// Every public function lives on `api`; see MAP_METHODS for the list.

export const MAP_METHODS = [
  'setTiles', 'setRoute', 'setNotes', 'setProgress', 'setWaypoints', 'setDriver',
  'follow', 'setView', 'fit', 'panTo', 'setTilt', 'highlight',
];

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
    html,body{width:100%;height:100%;overflow:hidden;background:#0d0f14}
    #map{position:absolute;left:0;top:0;width:100%;height:100%;background:#0d0f14}
    /* Follow view: the map is taller than the screen so its centre (the car) sits low,
       leaving most of the screen for the road ahead. */
    body.follow #map{height:124%}
    body.follow.tilt #map{left:-30%;width:160%;top:-48%;height:220%;
      transform:perspective(1000px) rotateX(28deg);transform-origin:50% 50%}
    .leaflet-container{font-family:system-ui,sans-serif}
    .wp{width:28px;height:28px;border-radius:14px;border:2.5px solid #fff;color:#fff;
      font:800 13px/23px system-ui,sans-serif;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.6)}
    .nm{filter:drop-shadow(0 1px 3px rgba(0,0,0,.7))}
    .nm.hl{transform:scale(1.5);filter:drop-shadow(0 0 6px #fff)}
    body.far .nm{display:none}
    .car{transition:transform .25s linear}
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = L.map('map',{
      rotate:true, bearing:0, zoomControl:false, attributionControl:false,
      touchRotate:false, rotateControl:false, zoomSnap:0.25
    }).setView([52.07,19.48],6);

    var tileLayer = null;
    var routeCasing=null, routeLine=null, drivenLine=null;
    var segLayer = L.layerGroup().addTo(map);
    var noteLayer = L.layerGroup().addTo(map);
    var wpLayer = L.layerGroup().addTo(map);
    var driverMarker=null, driverRot=0;
    var route=[], cum=[], noteMarkers={}, highlighted=null;
    var curBearing=0, anim=null, raf=null, lastFollow=0;

    function post(obj){
      var data = typeof obj==='string' ? obj : JSON.stringify(obj);
      try{
        if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(data);
        else if(window.parent&&window.parent!==window) window.parent.postMessage(data,'*');
      }catch(e){}
    }

    function setBearing(deg){
      curBearing=deg;
      // leaflet-rotate turns the map clockwise by the given angle; heading-up needs the opposite.
      try{ map.setBearing((360-deg)%360); }catch(e){}
    }

    function carIcon(){
      var html='<div class="car" style="width:34px;height:34px;transform:rotate('+driverRot+'deg)">'
        +'<svg width="34" height="34" viewBox="0 0 34 34" xmlns="http://www.w3.org/2000/svg">'
        +'<rect x="9" y="3" width="16" height="28" rx="5" fill="#f4f4f5" stroke="#0d0f14" stroke-width="2"/>'
        +'<path d="M11.5,13 Q17,9.5 22.5,13 L21.5,17 H12.5 Z" fill="#0d0f14"/>'
        +'<rect x="12.5" y="23" width="9" height="3.5" rx="1" fill="#0d0f14"/>'
        +'</svg></div>';
      return L.divIcon({className:'',html:html,iconSize:[34,34],iconAnchor:[17,17]});
    }

    function placeDriver(ll,rot){
      if(!driverMarker){
        driverRot=rot;
        driverMarker=L.marker(ll,{icon:carIcon(),zIndexOffset:2000,interactive:false}).addTo(map);
        return;
      }
      driverMarker.setLatLng(ll);
      if(Math.abs(rot-driverRot)>0.5){
        driverRot=rot;
        var el=driverMarker.getElement();
        var car=el&&el.querySelector('.car');
        if(car) car.style.transform='rotate('+rot+'deg)';
      }
    }

    function angDiff(a,b){ var d=(b-a)%360; if(d>180)d-=360; if(d<=-180)d+=360; return d; }

    function stopAnim(){ anim=null; if(raf){cancelAnimationFrame(raf);raf=null;} }

    function frame(now){
      raf=null;
      if(!anim) return;
      var k=Math.min(1,(now-anim.t0)/anim.dur);
      var lat=anim.a.lat+(anim.b.lat-anim.a.lat)*k;
      var lng=anim.a.lng+(anim.b.lng-anim.a.lng)*k;
      var brg=anim.a.brg+angDiff(anim.a.brg,anim.b.brg)*k;
      map.setView([lat,lng],map.getZoom(),{animate:false});
      if(Math.abs(angDiff(curBearing,brg))>0.3) setBearing((brg+360)%360);
      placeDriver([lat,lng],anim.rot);
      if(k<1) raf=requestAnimationFrame(frame); else anim=null;
    }

    function setBodyClass(name,on){
      var had=document.body.classList.contains(name);
      if(had===!!on) return false;
      document.body.classList.toggle(name,!!on);
      return true;
    }

    function leaveFollow(){
      stopAnim();
      if(setBodyClass('follow',false)) map.invalidateSize({animate:false});
    }

    function cumulative(pts){
      var out=[0];
      for(var i=1;i<pts.length;i++) out.push(out[i-1]+map.distance(pts[i-1],pts[i]));
      return out;
    }

    function refreshFar(){ setBodyClass('far',map.getZoom()<13.5); }
    map.on('zoomend',refreshFar); refreshFar();

    var api = {
      setTiles: function(url,opts){
        opts=opts||{};
        if(tileLayer) map.removeLayer(tileLayer);
        tileLayer=L.tileLayer(url,{maxZoom:19,maxNativeZoom:opts.maxNativeZoom||19}).addTo(map);
        map.getPane('tilePane').style.filter=opts.filter||'';
      },

      // coords: [[lat,lng],…] — empty clears the route.
      setRoute: function(coords){
        [routeCasing,routeLine,drivenLine].forEach(function(l){ if(l) map.removeLayer(l); });
        routeCasing=routeLine=drivenLine=null;
        route=coords||[]; cum=[];
        segLayer.clearLayers();
        if(route.length<2) return;
        cum=cumulative(route);
        routeCasing=L.polyline(route,{color:'#05060a',weight:10,opacity:0.9,interactive:false}).addTo(map);
        routeLine=L.polyline(route,{color:'#6b7483',weight:6,opacity:1,interactive:false}).addTo(map);
      },

      // segs: [{c:color, p:[[lat,lng],…]}] coloured corner sections
      // marks: [{id, lat, lng, svg}] note icons; interactive marks report taps
      setNotes: function(segs,marks,interactive){
        segLayer.clearLayers(); noteLayer.clearLayers(); noteMarkers={};
        (segs||[]).forEach(function(s){
          L.polyline(s.p,{color:s.c,weight:6,opacity:1,interactive:false,lineCap:'butt'}).addTo(segLayer);
        });
        (marks||[]).forEach(function(m){
          var icon=L.divIcon({className:'',html:'<div class="nm">'+m.svg+'</div>',iconSize:[26,26],iconAnchor:[13,34]});
          var mk=L.marker([m.lat,m.lng],{icon:icon,interactive:!!interactive,zIndexOffset:300}).addTo(noteLayer);
          if(interactive) mk.on('click',function(e){ L.DomEvent.stopPropagation(e); post({t:'noteClick',id:m.id}); });
          noteMarkers[m.id]=mk;
        });
        if(drivenLine) drivenLine.bringToFront();
        if(highlighted) api.highlight(highlighted);
      },

      highlight: function(id){
        var old=highlighted&&noteMarkers[highlighted];
        var oe=old&&old.getElement(); if(oe){ var n=oe.querySelector('.nm'); if(n) n.classList.remove('hl'); }
        highlighted=id||null;
        var mk=id&&noteMarkers[id];
        var el=mk&&mk.getElement(); if(el){ var m=el.querySelector('.nm'); if(m) m.classList.add('hl'); mk.setZIndexOffset(900); }
        if(old&&old!==mk) old.setZIndexOffset(300);
      },

      // Darkens the part of the route that is already behind the car.
      setProgress: function(d){
        if(route.length<2) return;
        var pts=[route[0]];
        for(var i=1;i<route.length && cum[i]<=d;i++) pts.push(route[i]);
        var j=pts.length;
        if(j<route.length && d>cum[j-1]){
          var t=(d-cum[j-1])/((cum[j]-cum[j-1])||1);
          pts.push([route[j-1][0]+(route[j][0]-route[j-1][0])*t, route[j-1][1]+(route[j][1]-route[j-1][1])*t]);
        }
        if(drivenLine) drivenLine.setLatLngs(pts);
        else drivenLine=L.polyline(pts,{color:'#16181d',weight:7,opacity:0.82,interactive:false,lineCap:'butt'}).addTo(map);
      },

      // wps: [{lat,lng,label}]
      setWaypoints: function(wps,draggable){
        wpLayer.clearLayers();
        (wps||[]).forEach(function(wp,i){
          var last=i===wps.length-1 && wps.length>1;
          var bg=i===0?'#16a34a':last?'#dc2626':'#2563eb';
          var icon=L.divIcon({className:'',html:'<div class="wp" style="background:'+bg+'">'+(i===0?'S':last?'M':i)+'</div>',iconSize:[28,28],iconAnchor:[14,14]});
          var m=L.marker([wp.lat,wp.lng],{icon:icon,draggable:!!draggable,zIndexOffset:600,interactive:!!draggable}).addTo(wpLayer);
          if(!draggable) return;
          m.on('click',function(e){ L.DomEvent.stopPropagation(e); post({t:'waypointClick',index:i}); });
          m.on('dragend',function(){ var ll=m.getLatLng(); post({t:'waypointMoved',index:i,lat:ll.lat,lng:ll.lng}); });
        });
      },

      // Free view: just put the car on the map (heading relative to north).
      setDriver: function(lat,lng,heading){
        if(anim) return;
        placeDriver([lat,lng],((heading||0)-curBearing+360)%360);
      },

      // Driving view: glide the camera (and the car) to the new fix.
      follow: function(lat,lng,heading,zoom,headingUp){
        var now=performance.now();
        var changed=setBodyClass('follow',true);
        if(changed) map.invalidateSize({animate:false});
        var brg=headingUp?(heading||0):0;
        var rot=headingUp?0:(heading||0);
        var c=map.getCenter();
        var jump=changed || Math.abs(map.getZoom()-zoom)>0.01 || map.distance(c,[lat,lng])>400;
        var dur=Math.max(250,Math.min(1500,now-lastFollow));
        lastFollow=now;
        if(jump){
          stopAnim();
          map.setView([lat,lng],zoom,{animate:false});
          setBearing(brg); placeDriver([lat,lng],rot);
          return;
        }
        anim={t0:now,dur:dur,rot:rot,a:{lat:c.lat,lng:c.lng,brg:curBearing},b:{lat:lat,lng:lng,brg:brg}};
        if(!raf) raf=requestAnimationFrame(frame);
      },

      setTilt: function(on){
        if(setBodyClass('tilt',on)) map.invalidateSize({animate:false});
      },

      setView: function(lat,lng,zoom){
        leaveFollow(); setBearing(0);
        map.setView([lat,lng],zoom||map.getZoom(),{animate:true});
      },

      panTo: function(lat,lng,minZoom){
        leaveFollow(); setBearing(0);
        map.setView([lat,lng],Math.max(map.getZoom(),minZoom||0),{animate:true});
      },

      // Shows the whole route (or the given points), keeping clear of UI panels.
      fit: function(points,padTop,padBottom){
        var pts=(points&&points.length)?points:route;
        if(!pts.length) return;
        leaveFollow(); setBearing(0);
        if(pts.length===1){ map.setView(pts[0],15,{animate:true}); return; }
        map.fitBounds(L.latLngBounds(pts),{
          paddingTopLeft:[30,(padTop||0)+30], paddingBottomRight:[30,(padBottom||0)+30],
          maxZoom:17, animate:true
        });
      }
    };

    map.on('dragstart',function(){ if(document.body.classList.contains('follow')){ stopAnim(); post({t:'userPan'}); } });
    map.on('contextmenu',function(e){ post({t:'mapLongPress',lat:e.latlng.lat,lng:e.latlng.lng}); });
    map.on('click',function(e){ post({t:'mapClick',lat:e.latlng.lat,lng:e.latlng.lng}); });

    window.__call=function(fn,args){ try{ if(api[fn]) api[fn].apply(null,args||[]); }catch(e){} };
    window.addEventListener('message',function(e){
      try{ var msg=JSON.parse(e.data); if(msg&&msg.fn) window.__call(msg.fn,msg.args); }catch(err){}
    });

    post('ready');
  </script>
</body>
</html>`;
