import { useAuth, useUser } from '@clerk/clerk-expo';
import { useStripe } from '@stripe/stripe-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { GradientButton, ScreenContainer, SectionHeader } from '../components';
import { useSupabaseClient } from '../lib/supabase';
import { getUserProfile, upsertUserProfile, UserProfileRecord } from '../services/database';
import { createSubscriptionPaymentSheet, StripePlan } from '../services/payments';

function calculateBmi(weightLb: number, heightFtIn: string) {
  const [feet = 0, inches = 0] = heightFtIn
    .split("'")
    .map((part) => Number(part.replace(/\D/g, '')));
  const totalInches = feet * 12 + inches;
  if (!weightLb || !totalInches) return null;
  return Number(((weightLb / (totalInches * totalInches)) * 703).toFixed(1));
}

export function MeScreen({ onBackHome }: { onBackHome: () => void }) {
  const { user } = useUser();
  const { signOut } = useAuth();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const supabase = useSupabaseClient();
  const [tab, setTab] = useState<'profile' | 'membership'>('profile');
  const [weightLb, setWeightLb] = useState('');
  const [heightFtIn, setHeightFtIn] = useState('');
  const [daysPerWeek, setDaysPerWeek] = useState('');
  const [loadingPlan, setLoadingPlan] = useState<StripePlan | null>(null);

  const bmi = useMemo(() => calculateBmi(Number(weightLb), heightFtIn), [weightLb, heightFtIn]);

  useEffect(() => {
    if (!user?.id || !supabase) return;

    void getUserProfile(user.id, supabase)
      .then((profile) => {
        if (!profile) return;
        setWeightLb(profile.weight_lb ? String(profile.weight_lb) : '');
        setHeightFtIn(profile.height_ft_in ?? '');
        setDaysPerWeek(profile.committed_days_per_week ? String(profile.committed_days_per_week) : '');
      })
      .catch(() => undefined);
  }, [supabase, user?.id]);

  const saveProfile = async () => {
    if (!user?.id || !supabase) return;

    const profile: UserProfileRecord = {
      user_id: user.id,
      weight_lb: weightLb ? Number(weightLb) : null,
      height_ft_in: heightFtIn || null,
      committed_days_per_week: daysPerWeek ? Number(daysPerWeek) : null,
      bmi,
    };

    try {
      await upsertUserProfile(profile, supabase);
      Alert.alert('Saved', 'Your profile is synced with Supabase.');
    } catch (error) {
      Alert.alert('Save failed', error instanceof Error ? error.message : 'Please try again.');
    }
  };

  const startMembership = async (plan: StripePlan) => {
    if (!user?.id) return;
    setLoadingPlan(plan);
    try {
      const payment = await createSubscriptionPaymentSheet({
        clerkUserId: user.id,
        email: user.primaryEmailAddress?.emailAddress,
        plan,
      });

      const init = await initPaymentSheet({
        merchantDisplayName: 'DopaPeak',
        customerId: payment.customerId,
        customerEphemeralKeySecret: payment.ephemeralKeySecret,
        paymentIntentClientSecret: payment.paymentIntentClientSecret,
        allowsDelayedPaymentMethods: true,
      });

      if (init.error) throw new Error(init.error.message);
      const result = await presentPaymentSheet();
      if (result.error) throw new Error(result.error.message);
      Alert.alert('Elite unlocked', 'Your Dopa Elite subscription is active.');
    } catch (error) {
      Alert.alert('Payment failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setLoadingPlan(null);
    }
  };

  return (
    <ScreenContainer>
      <SectionHeader
        eyebrow="Me"
        title={user?.fullName ?? 'Your profile'}
        subtitle={user?.primaryEmailAddress?.emailAddress ?? 'Profile and membership settings'}
      />

      <View className="mb-5 flex-row rounded-3xl bg-secondary p-1">
        {(['profile', 'membership'] as const).map((item) => (
          <Text
            key={item}
            onPress={() => setTab(item)}
            className={`flex-1 rounded-2xl py-3 text-center text-sm font-black uppercase ${
              tab === item ? 'bg-accent text-primary' : 'text-white/45'
            }`}
          >
            {item}
          </Text>
        ))}
      </View>

      {tab === 'profile' ? (
        <View className="rounded-3xl bg-secondary p-5">
          <ProfileInput value={weightLb} onChangeText={setWeightLb} placeholder="Weight (lb)" />
          <ProfileInput value={heightFtIn} onChangeText={setHeightFtIn} placeholder="Height (example: 5'10)" />
          <ProfileInput value={daysPerWeek} onChangeText={setDaysPerWeek} placeholder="Committed days per week" />
          <Text className="mb-4 text-sm font-bold text-white/50">BMI: {bmi ?? '--'}</Text>
          <GradientButton label="Save Profile" onPress={saveProfile} />
        </View>
      ) : (
        <View className="rounded-3xl border border-accent/25 bg-secondary p-5">
          <Text className="text-xl font-black text-white">Dopa Elite Mode</Text>
          <Text className="mt-2 text-sm leading-6 text-white/50">
            Unlock Analytics & Unlimited Plans with Stripe-powered subscription billing.
          </Text>
          <GradientButton
            className="mt-5"
            label={loadingPlan === 'annual' ? 'Starting...' : 'Annual Membership ($99/year - Save 40%)'}
            onPress={() => startMembership('annual')}
            disabled={loadingPlan !== null}
          />
          <GradientButton
            className="mt-3"
            label={loadingPlan === 'monthly' ? 'Starting...' : 'Monthly Membership ($14/month)'}
            onPress={() => startMembership('monthly')}
            disabled={loadingPlan !== null}
          />
        </View>
      )}

      <Text className="mt-6 text-center text-sm font-bold text-accent" onPress={onBackHome}>
        Back to Home
      </Text>
      <Text className="mt-4 text-center text-xs font-bold text-white/35" onPress={() => void signOut()}>
        Sign out
      </Text>
    </ScreenContainer>
  );
}

function ProfileInput({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="rgba(255,255,255,0.28)"
      keyboardType="numbers-and-punctuation"
      className="mb-3 rounded-2xl border border-white/10 bg-primary px-4 py-4 text-white"
    />
  );
}
