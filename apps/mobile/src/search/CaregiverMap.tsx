import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { MapCityPoint, SearchOrigin } from '@care-platform/shared';
import { webViewAvailable } from '@/care/PayhereSheet';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Text } from '@/ui/Text';

/** The same map as the website: MapLibre with OpenFreeMap tiles - open source, no API key, no usage limits. */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
/** The website's MapLibre version (apps/public-web), loaded inside the map page. */
const MAPLIBRE = 'https://unpkg.com/maplibre-gl@6.16.0/dist';

/** What the map page draws: everything as data, so the page itself never changes. */
export interface MapScene {
  origin: SearchOrigin | null;
  points: MapCityPoint[];
  /** The tap-to-read label of each point, in the app's language. */
  labels: Record<string, string>;
  originLabel: string;
  brand: string;
}

/**
 * The map page. It loads MapLibre, then draws whatever scene the app sends it
 * (window.draw), and tells the app if the map couldn't load. Caregivers appear
 * only as counts on the city they live in - never an address or a single pin -
 * and the origin carries the search radius as a circle.
 */
export function mapHtml(styleUrl: string): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="${MAPLIBRE}/maplibre-gl.css">
<style>html,body,#map{margin:0;height:100%;font-family:sans-serif}
.dot{border-radius:999px;color:#fff;font:600 13px sans-serif;min-width:28px;height:28px;display:flex;align-items:center;justify-content:center;padding:0 6px;box-shadow:0 1px 4px rgba(0,0,0,.3);border:2px solid #fff}
.me{width:18px;height:18px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,.25)}</style></head>
<body><div id="map"></div>
<script src="${MAPLIBRE}/maplibre-gl.js"></script>
<script>
(function(){
  var send=function(m){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(m));};
  if(!window.maplibregl){send({type:'failed'});return;}
  var map=new maplibregl.Map({container:'map',style:${JSON.stringify(styleUrl)},bounds:[[79.55,5.9],[81.9,9.85]],attributionControl:{compact:true},dragRotate:false,pitchWithRotate:false});
  map.touchZoomRotate.disableRotation();
  var markers=[],pending=null,loaded=false;
  map.on('error',function(e){if(!loaded)send({type:'failed'});});
  function circle(c,km){var lat=km/110.574,lng=km/(111.32*Math.cos(c.latitude*Math.PI/180)),r=[];for(var i=0;i<=64;i++){var a=i/64*2*Math.PI;r.push([c.longitude+lng*Math.cos(a),c.latitude+lat*Math.sin(a)]);}return r;}
  function draw(s){
    if(!loaded){pending=s;return;}
    markers.forEach(function(m){m.remove();});markers=[];
    var pts=[];
    s.points.forEach(function(p){
      var el=document.createElement('div');el.className='dot';el.style.background=s.brand;el.textContent=p.count;el.title=s.labels[p.key]||'';
      el.addEventListener('click',function(){send({type:'point',key:p.key});});
      markers.push(new maplibregl.Marker({element:el}).setLngLat([p.longitude,p.latitude]).addTo(map));pts.push([p.longitude,p.latitude]);
    });
    var src=map.getSource('radius'),ring={type:'Feature',geometry:{type:'Polygon',coordinates:[s.origin?circle(s.origin,s.origin.radiusKm):[]]},properties:{}};
    if(src)src.setData(ring);else{map.addSource('radius',{type:'geojson',data:ring});map.addLayer({id:'radius',type:'fill',source:'radius',paint:{'fill-color':s.brand,'fill-opacity':0.08}});map.addLayer({id:'radius-line',type:'line',source:'radius',paint:{'line-color':s.brand,'line-width':1.5}});}
    if(s.origin){
      var me=document.createElement('div');me.className='me';me.style.background=s.brand;me.title=s.originLabel;
      markers.push(new maplibregl.Marker({element:me}).setLngLat([s.origin.longitude,s.origin.latitude]).addTo(map));
      circle(s.origin,s.origin.radiusKm).forEach(function(c){pts.push(c);});
    }
    if(pts.length){var b=pts.reduce(function(b,c){return[[Math.min(b[0][0],c[0]),Math.min(b[0][1],c[1])],[Math.max(b[1][0],c[0]),Math.max(b[1][1],c[1])]];},[[Infinity,Infinity],[-Infinity,-Infinity]]);
      map.fitBounds([[b[0][0]-0.02,b[0][1]-0.02],[b[1][0]+0.02,b[1][1]+0.02]],{padding:24,maxZoom:12,duration:0});}
  }
  window.draw=draw;
  map.on('load',function(){loaded=true;send({type:'ready'});if(pending)draw(pending);});
})();
</script></body></html>`;
}

/**
 * Caregivers around the search location (or, before searching, where
 * caregivers are), as on the website. Drawn in the in-app browser: the same
 * map, no map API key. Tapping a count says what it is. Nothing is shown in a
 * build without the in-app browser, or when the map can't load - every
 * caregiver's distance is in the list either way.
 */
export function CaregiverMap({ origin, points, labelFor }: { origin: SearchOrigin | null; points: MapCityPoint[]; labelFor: (p: MapCityPoint) => string }) {
  const { t } = useTranslation();
  const colors = useColors();
  const ref = useRef<{ injectJavaScript(js: string): void } | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const html = useMemo(() => mapHtml(MAP_STYLE_URL), []);

  const scene: MapScene = useMemo(
    () => ({
      origin,
      points,
      labels: Object.fromEntries(points.map((p) => [p.key, labelFor(p)])),
      originLabel: origin?.source === 'device' ? t('map.originDevice') : `${t('map.origin')}: ${origin?.label ?? ''}`,
      brand: colors.brand,
    }),
    // labelFor changes every render; the labels only change with the points and the language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [origin, points, colors.brand, t],
  );

  // Draw again whenever there's something new to show.
  useEffect(() => {
    if (ready) ref.current?.injectJavaScript(`window.draw(${JSON.stringify(scene)});true;`);
  }, [ready, scene]);

  if (!webViewAvailable() || failed) {
    return failed ? <Text style={{ fontSize: 14, color: colors.muted }}>{t('map.failed')}</Text> : null;
  }
  const { WebView } = require('react-native-webview') as typeof import('react-native-webview');
  const pickedPoint = points.find((p) => p.key === picked);

  return (
    <View style={{ gap: 6 }}>
      <View accessible accessibilityLabel={t('map.mapLabel')} style={[styles.map, { borderColor: colors.border }]}>
        <WebView
          ref={ref as never}
          testID="caregiver-map"
          originWhitelist={['https://*', 'about:*']}
          source={{ html, baseUrl: 'https://tiles.openfreemap.org' }}
          onMessage={(e) => {
            const message = JSON.parse(e.nativeEvent.data) as { type: string; key?: string };
            if (message.type === 'ready') setReady(true);
            if (message.type === 'failed') setFailed(true);
            if (message.type === 'point') setPicked(message.key ?? null);
          }}
          // Links on the map (the attribution) open nowhere inside it.
          onShouldStartLoadWithRequest={(req) => req.url.startsWith('about:') || req.url.startsWith('https://tiles.openfreemap.org')}
          scrollEnabled={false}
          javaScriptEnabled
          style={{ flex: 1 }}
        />
      </View>
      {pickedPoint ? (
        <Text accessibilityLiveRegion="polite" style={{ fontSize: 14, color: colors.ink }}>
          {labelFor(pickedPoint)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  map: { height: 260, borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
});
