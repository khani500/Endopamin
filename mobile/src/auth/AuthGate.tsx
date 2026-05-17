import { SignedIn, SignedOut } from '@clerk/clerk-expo';
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { GradientButton, ScreenContainer, SectionHeader } from '../components';
import { SignInForm } from './SignInForm';
import { SignUpForm } from './SignUpForm';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');

  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut>
        <ScreenContainer>
          <SectionHeader
            eyebrow="ENDOPAMIN"
            title={mode === 'sign-in' ? 'Welcome back' : 'Create your account'}
            subtitle="Clerk powers secure authentication for the mobile app."
          />
          <View className="rounded-3xl bg-secondary p-5">
            {mode === 'sign-in' ? <SignInForm /> : <SignUpForm />}
            <Text
              className="mt-5 text-center text-sm font-bold text-accent"
              onPress={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
            >
              {mode === 'sign-in' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
            </Text>
          </View>
        </ScreenContainer>
      </SignedOut>
    </>
  );
}

export function AuthInput({
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="rgba(255,255,255,0.28)"
      secureTextEntry={secureTextEntry}
      autoCapitalize="none"
      className="mb-3 rounded-2xl border border-white/10 bg-primary px-4 py-4 text-white"
    />
  );
}

export { GradientButton };
