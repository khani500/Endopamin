import { LinearGradient } from 'expo-linear-gradient';
import { PropsWithChildren } from 'react';
import { Pressable, Text, ViewStyle } from 'react-native';
import { colors } from '../theme/colors';

type GradientButtonProps = PropsWithChildren<{
  label?: string;
  onPress?: () => void;
  disabled?: boolean;
  className?: string;
  textClassName?: string;
  style?: ViewStyle;
}>;

export function GradientButton({
  children,
  label,
  onPress,
  disabled = false,
  className = '',
  textClassName = '',
  style,
}: GradientButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      className={`overflow-hidden rounded-2xl ${disabled ? 'opacity-50' : 'opacity-100'} ${className}`}
      style={style}
    >
      <LinearGradient
        colors={[colors.accent, '#E8FF66']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        className="items-center justify-center px-5 py-4"
      >
        {children ?? (
          <Text className={`text-base font-black text-primary ${textClassName}`}>
            {label}
          </Text>
        )}
      </LinearGradient>
    </Pressable>
  );
}
