import { useSignUp } from '@clerk/clerk-expo';
import { useState } from 'react';
import { Alert } from 'react-native';
import { AuthInput, GradientButton } from './AuthGate';

export function SignUpForm() {
  const { signUp, setActive, isLoaded } = useSignUp();
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const onSignUp = async () => {
    if (!isLoaded) return;
    setLoading(true);
    try {
      const result = await signUp.create({ emailAddress: emailAddress.trim(), password });
      await setActive({ session: result.createdSessionId });
    } catch (error) {
      Alert.alert('Sign up failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <AuthInput value={emailAddress} onChangeText={setEmailAddress} placeholder="Email" />
      <AuthInput value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry />
      <GradientButton label={loading ? 'Creating account...' : 'Sign Up'} onPress={onSignUp} />
    </>
  );
}
