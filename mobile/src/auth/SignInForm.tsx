import { useSignIn } from '@clerk/clerk-expo';
import { useState } from 'react';
import { Alert } from 'react-native';
import { AuthInput, GradientButton } from './AuthGate';

export function SignInForm() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const onSignIn = async () => {
    if (!isLoaded) return;
    setLoading(true);
    try {
      const result = await signIn.create({ identifier: emailAddress.trim(), password });
      await setActive({ session: result.createdSessionId });
    } catch (error) {
      Alert.alert('Sign in failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <AuthInput value={emailAddress} onChangeText={setEmailAddress} placeholder="Email" />
      <AuthInput value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry />
      <GradientButton label={loading ? 'Signing in...' : 'Sign In'} onPress={onSignIn} />
    </>
  );
}
