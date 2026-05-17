import { PropsWithChildren } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type ScreenContainerProps = PropsWithChildren<{
  scroll?: boolean;
  className?: string;
  contentClassName?: string;
}>;

export function ScreenContainer({
  children,
  scroll = true,
  className = '',
  contentClassName = '',
}: ScreenContainerProps) {
  return (
    <SafeAreaView className={`flex-1 bg-primary ${className}`}>
      {scroll ? (
        <ScrollView
          className="flex-1"
          contentContainerClassName={`px-5 pb-8 pt-4 ${contentClassName}`}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View className={`flex-1 px-5 pb-8 pt-4 ${contentClassName}`}>{children}</View>
      )}
    </SafeAreaView>
  );
}
