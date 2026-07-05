import { useEffect } from 'react';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import Svg, { Circle, Ellipse, Path, G, Line } from 'react-native-svg';
import { colors } from '../../theme';
import { getPose, type MascotPose } from './poses';

const RAYS = Array.from({ length: 8 }, (_, i) => (i * 360) / 8);

export function Mascot({ pose = 'idle', size = 120, animate = true }: {
  pose?: MascotPose; size?: number; animate?: boolean;
}) {
  const p = getPose(pose);
  const bob = useSharedValue(0);

  useEffect(() => {
    if (animate) {
      bob.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }), -1, true);
    }
  }, [animate, bob]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateY: bob.value * -4 }] }));

  return (
    <Animated.View style={style}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <G rotation={p.rayRotate} origin="50, 52">
          {RAYS.map((deg) => (
            <Line
              key={deg}
              x1="50" y1={52 - 30} x2="50" y2={52 - 30 - 8 * p.rayScale}
              stroke={colors.star} strokeWidth="4" strokeLinecap="round"
              transform={`rotate(${deg} 50 52)`}
            />
          ))}
        </G>
        <Circle cx="50" cy="52" r="26" fill={colors.accent} />
        <Ellipse cx="42" cy="48" rx="3" ry={p.eyeRy} fill={colors.white} />
        <Ellipse cx="58" cy="48" rx="3" ry={p.eyeRy} fill={colors.white} />
        <Path d={p.mouthPath} stroke={colors.white} strokeWidth="3" strokeLinecap="round" fill="none" />
      </Svg>
    </Animated.View>
  );
}
