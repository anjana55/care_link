import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';

/**
 * The welcome picture: two smiling caregivers - a woman in a white coat with a
 * stethoscope and a man in blue scrubs with a clipboard - in a flat style,
 * cropped at the waist by the band they stand in. Drawn, not a bitmap, so it
 * is sharp on every phone and the woman's top and the backdrop take the
 * deployment's brand colour. `width` sets the size; the height follows.
 */
export function CaregiversIllustration({ width = 340 }: { width?: number }) {
  const { t } = useTranslation();
  const colors = useColors();
  const height = (width * 320) / 360;
  const navy = colors.deep;
  return (
    <Svg width={width} height={height} viewBox="0 0 360 320" accessibilityRole="image" accessibilityLabel={t('welcome.pictureLabel')} testID="caregivers-illustration">
      {/* Backdrop: a light circle, small plus signs and a heart. */}
      <Circle cx={180} cy={230} r={150} fill="#FFFFFF" fillOpacity={0.72} />
      <Path d="M44 92 h16 M52 84 v16" stroke="#FFFFFF" strokeWidth={5} strokeLinecap="round" />
      <Path d="M310 70 h12 M316 64 v12" stroke="#FFFFFF" strokeWidth={4} strokeLinecap="round" />
      <Circle cx={300} cy={118} r={5} fill="#FFFFFF" />
      <Circle cx={62} cy={150} r={4} fill="#FFFFFF" />
      <Path d="M188 66 C176 58 170 50 174 43 C177 37 185 37 188 43 C191 37 199 37 202 43 C206 50 200 58 188 66 Z" fill="#E2557A" />

      {/* The man, behind: blue scrubs, short hair, a clipboard. */}
      <Path d="M168 320 C168 240 192 214 248 210 C304 214 330 240 330 320 Z" fill="#3B6FB6" />
      <Rect x={240} y={180} width={16} height={34} rx={6} fill="#B8774E" />
      <Path d="M230 211 L248 240 L266 211 Z" fill="#B8774E" />
      <Path d="M228 211 L248 244 L268 211" fill="none" stroke="#2C5793" strokeWidth={4} strokeLinejoin="round" />
      <Circle cx={215} cy={152} r={8} fill="#B8774E" />
      <Circle cx={281} cy={152} r={8} fill="#B8774E" />
      <Ellipse cx={248} cy={148} rx={33} ry={37} fill="#C68A5E" />
      <Path d="M214 140 C211 104 232 94 249 94 C270 94 285 106 282 140 C276 122 264 115 248 117 C232 118 220 126 214 140 Z" fill="#1E1E2A" />
      <Path d="M228 140 Q235 135 242 140 M254 140 Q261 135 268 140" fill="none" stroke="#1E1E2A" strokeWidth={3} strokeLinecap="round" />
      <Circle cx={235} cy={150} r={3} fill="#1E1E2A" />
      <Circle cx={261} cy={150} r={3} fill="#1E1E2A" />
      <Path d="M234 164 Q248 178 262 164 Z" fill="#FFFFFF" stroke="#5A2E18" strokeWidth={2.5} strokeLinejoin="round" />
      <Rect x={262} y={238} width={48} height={64} rx={7} fill="#FFFFFF" stroke={navy} strokeWidth={3} />
      <Rect x={274} y={232} width={24} height={12} rx={4} fill={navy} />
      <Path d="M272 258 h28 M272 270 h28 M272 282 h18" stroke="#9FB3C3" strokeWidth={3} strokeLinecap="round" />
      <Path d="M218 300 C230 284 248 276 266 272" fill="none" stroke="#3B6FB6" strokeWidth={24} strokeLinecap="round" />
      <Circle cx={268} cy={272} r={11} fill="#C68A5E" />
      <Rect x={190} y={246} width={26} height={8} rx={3} fill="#FFFFFF" />

      {/* The woman, in front: white coat over a top in the brand colour, stethoscope. */}
      <Path d="M86 160 C82 108 104 92 127 92 C152 92 172 108 168 160 C168 186 162 202 152 210 L100 210 C92 200 86 184 86 160 Z" fill="#2B2233" />
      <Path d="M34 320 C34 240 64 216 127 212 C190 216 220 240 220 320 Z" fill="#F7FBFB" stroke="#C9D6DC" strokeWidth={2} />
      <Path d="M100 214 L127 320 L154 214 Z" fill={colors.brand} />
      <Rect x={119} y={182} width={16} height={34} rx={6} fill="#E8B48C" />
      <Path d="M112 214 L127 238 L142 214 Z" fill="#E8B48C" />
      <Path d="M100 214 L120 278 M154 214 L134 278" stroke="#C9D6DC" strokeWidth={3} fill="none" />
      <Path d="M106 218 C96 256 112 276 127 276 C142 276 158 256 148 218" fill="none" stroke={navy} strokeWidth={4} strokeLinecap="round" />
      <Circle cx={127} cy={284} r={9} fill={navy} />
      <Circle cx={127} cy={284} r={4} fill="#9FB3C3" />
      <Rect x={170} y={268} width={28} height={24} rx={4} fill="none" stroke="#C9D6DC" strokeWidth={2.5} />
      <Path d="M178 260 v14" stroke={colors.brand} strokeWidth={4} strokeLinecap="round" />
      <Path d="M187 262 v12" stroke="#E2557A" strokeWidth={4} strokeLinecap="round" />
      <Ellipse cx={127} cy={146} rx={32} ry={36} fill="#EDBE97" />
      <Circle cx={95} cy={156} r={3.5} fill="#E9A23B" />
      <Circle cx={159} cy={156} r={3.5} fill="#E9A23B" />
      <Path d="M95 138 C96 104 118 98 132 100 C152 102 162 116 160 140 C152 124 142 118 128 120 C114 124 104 128 95 138 Z" fill="#2B2233" />
      <Path d="M108 140 Q115 135 122 140 M132 140 Q139 135 146 140" fill="none" stroke="#2B2233" strokeWidth={3} strokeLinecap="round" />
      <Circle cx={115} cy={150} r={3} fill="#2B2233" />
      <Circle cx={139} cy={150} r={3} fill="#2B2233" />
      <Circle cx={106} cy={162} r={6} fill="#F2A3A0" fillOpacity={0.7} />
      <Circle cx={148} cy={162} r={6} fill="#F2A3A0" fillOpacity={0.7} />
      <Path d="M115 164 Q127 176 139 164 Z" fill="#FFFFFF" stroke="#B84A5E" strokeWidth={2.5} strokeLinejoin="round" />
    </Svg>
  );
}
