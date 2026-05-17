import { Text, View } from 'react-native';

type SectionHeaderProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
};

export function SectionHeader({ eyebrow, title, subtitle, action }: SectionHeaderProps) {
  return (
    <View className="mb-4 flex-row items-end justify-between gap-4">
      <View className="flex-1">
        {eyebrow ? (
          <Text className="mb-1 text-xs font-black uppercase tracking-[2px] text-accent">
            {eyebrow}
          </Text>
        ) : null}
        <Text className="text-2xl font-black tracking-[-1px] text-white">{title}</Text>
        {subtitle ? (
          <Text className="mt-1 text-sm leading-5 text-white/45">{subtitle}</Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}
