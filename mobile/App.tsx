import './global.css';

import { ClerkProvider } from '@clerk/clerk-expo';
import { StripeProvider } from '@stripe/stripe-react-native';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { AuthGate } from './src/auth/AuthGate';
import { tokenCache } from './src/auth/tokenCache';
import { ScreenContainer, SectionHeader } from './src/components';
import { env, isClerkConfigured, isStripeConfigured, isSupabaseConfigured } from './src/config/env';
import { HomeScreen, MeScreen } from './src/screens';
import { DopaThemeProvider } from './src/theme';

function MissingConfigScreen() {
  const checks = [
    ['Clerk', isClerkConfigured],
    ['Supabase', isSupabaseConfigured],
    ['Stripe', isStripeConfigured],
  ] as const;

  return (
    <ScreenContainer>
      <SectionHeader
        eyebrow="DopaPeak"
        title="Service keys required"
        subtitle="Add the Expo public keys to mobile/.env before running Clerk, Supabase, and Stripe."
      />
      <View className="rounded-3xl bg-secondary p-5">
        {checks.map(([label, ready]) => (
          <View key={label} className="mb-3 flex-row items-center justify-between">
            <Text className="text-base font-black text-white">{label}</Text>
            <Text className={`text-sm font-black ${ready ? 'text-accent' : 'text-white/35'}`}>
              {ready ? 'Configured' : 'Missing'}
            </Text>
          </View>
        ))}
        <Text className="mt-3 text-xs leading-5 text-white/45">
          Required vars: EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY, EXPO_PUBLIC_SUPABASE_URL,
          EXPO_PUBLIC_SUPABASE_ANON_KEY, EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY,
          EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL.
        </Text>
      </View>
    </ScreenContainer>
  );
}

function MobileShell() {
  const [screen, setScreen] = useState<'home' | 'me'>('home');

  if (screen === 'me') {
    return <MeScreen onBackHome={() => setScreen('home')} />;
  }

  return <HomeScreen onOpenMe={() => setScreen('me')} />;
}

export default function App() {
  if (!isClerkConfigured || !isSupabaseConfigured || !isStripeConfigured) {
    return (
      <DopaThemeProvider>
        <StatusBar style="light" backgroundColor="#000000" />
        <MissingConfigScreen />
      </DopaThemeProvider>
    );
  }

  return (
    <DopaThemeProvider>
      <ClerkProvider publishableKey={env.clerkPublishableKey} tokenCache={tokenCache}>
        <StripeProvider publishableKey={env.stripePublishableKey} merchantIdentifier="merchant.com.dopapeak">
          <StatusBar style="light" backgroundColor="#000000" />
          <AuthGate>
            <MobileShell />
          </AuthGate>
        </StripeProvider>
      </ClerkProvider>
    </DopaThemeProvider>
  );
}
