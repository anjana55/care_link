import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useColors } from '@/theme';

/**
 * The small pictures on the client home's cards: one per thing a client can
 * do, drawn in the deployment's brand colour on a white ground, so a
 * white-labelled build gets them in its own colour. Decorative - the card's
 * words say what it is - so screen readers skip them.
 */
export type HomeArtName = 'find' | 'bookings' | 'care' | 'bills' | 'saved' | 'requests';

export function HomeArt({ name, width = 100 }: { name: HomeArtName; width?: number }) {
  const { brand } = useColors();
  const W = '#FFFFFF';
  return (
    <Svg width={width} height={(width * 80) / 100} viewBox="0 0 100 80" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID={`home-art-${name}`}>
      {name === 'find' ? (
        <>
          <Circle cx={40} cy={36} r={20} fill={W} stroke={brand} strokeWidth={6} />
          <Path d="M55 51l16 16" stroke={brand} strokeWidth={8} strokeLinecap="round" />
          <Circle cx={40} cy={31} r={6} fill={brand} />
          <Path d="M29 46c2-7 20-7 22 0" fill={brand} />
          <Circle cx={86} cy={20} r={7} fill={brand} fillOpacity={0.35} />
        </>
      ) : null}
      {name === 'bookings' ? (
        <>
          <Rect x={16} y={14} width={64} height={58} rx={10} fill={W} stroke={brand} strokeWidth={5} />
          <Rect x={16} y={14} width={64} height={16} rx={8} fill={brand} />
          <Circle cx={34} cy={46} r={5} fill={brand} fillOpacity={0.35} />
          <Circle cx={50} cy={46} r={5} fill={brand} />
          <Circle cx={66} cy={46} r={5} fill={brand} fillOpacity={0.35} />
          <Circle cx={34} cy={60} r={5} fill={brand} fillOpacity={0.35} />
          <Circle cx={88} cy={62} r={9} fill={brand} fillOpacity={0.35} />
        </>
      ) : null}
      {name === 'care' ? (
        <>
          <Rect x={18} y={10} width={56} height={66} rx={10} fill={W} stroke={brand} strokeWidth={5} />
          <Path d="M28 30l5 5 9-9M28 52l5 5 9-9" stroke={brand} strokeWidth={5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Rect x={48} y={27} width={16} height={5} rx={2.5} fill={brand} fillOpacity={0.5} />
          <Rect x={48} y={49} width={16} height={5} rx={2.5} fill={brand} fillOpacity={0.5} />
          <Circle cx={88} cy={20} r={8} fill={brand} fillOpacity={0.35} />
        </>
      ) : null}
      {name === 'bills' ? (
        <>
          <Path d="M22 10h44v66l-7-5-7 5-8-5-8 5-7-5-7 5z" fill={W} stroke={brand} strokeWidth={5} strokeLinejoin="round" />
          <Rect x={32} y={26} width={24} height={5} rx={2.5} fill={brand} />
          <Rect x={32} y={40} width={18} height={5} rx={2.5} fill={brand} fillOpacity={0.5} />
          <Circle cx={78} cy={56} r={14} fill={brand} />
          <Path d="M78 49v14M74 53h6a3 3 0 0 1 0 6h-6" stroke={W} strokeWidth={3} fill="none" strokeLinecap="round" />
        </>
      ) : null}
      {name === 'saved' ? (
        <>
          <Path d="M48 70S16 52 16 32a14 14 0 0 1 32-8 14 14 0 0 1 32 8c0 20-32 38-32 38z" fill={brand} />
          <Circle cx={88} cy={22} r={7} fill={brand} fillOpacity={0.35} />
          <Circle cx={12} cy={66} r={5} fill={brand} fillOpacity={0.35} />
        </>
      ) : null}
      {name === 'requests' ? (
        <>
          <Path d="M12 18h46a8 8 0 0 1 8 8v22a8 8 0 0 1-8 8H30l-12 10V56h-6a8 8 0 0 1-8-8V26a8 8 0 0 1 8-8z" fill={W} stroke={brand} strokeWidth={5} strokeLinejoin="round" />
          <Path d="M50 34h34a6 6 0 0 1 6 6v20a6 6 0 0 1-6 6h-2v10l-12-10H50a6 6 0 0 1-6-6V40a6 6 0 0 1 6-6z" fill={brand} />
        </>
      ) : null}
    </Svg>
  );
}
