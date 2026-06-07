import React from 'react';
import { StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import STTScreen from '../screens/STTScreen';
import DiarizationScreen from '../screens/DiarizationScreen';
import OrchestratorScreen from '../screens/OrchestratorScreen';
import { AudioFile } from '../types/benchmark';
import { COLORS, FONTS } from '../components/theme';

// ---------------------------------------------------------------------------
// Param list — both screens receive the shared audio state via tab options.
// We pass them as initialParams and control via the parent App.tsx via a
// shared ref pattern; but for simplicity we thread props through screenOptions.
// ---------------------------------------------------------------------------

const Tab = createBottomTabNavigator();

interface Props {
  audioFile: AudioFile | null;
  onAudioFileChange: (file: AudioFile | null) => void;
}

export default function TabNavigator({ audioFile, onAudioFileChange }: Props) {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: COLORS.accent,
        tabBarInactiveTintColor: COLORS.muted,
        tabBarLabelStyle: styles.tabLabel,
        tabBarIconStyle: { display: 'none' }, // text-only tabs, no icons
      }}
    >
      <Tab.Screen
        name="STT"
        options={{ tabBarLabel: 'STT' }}
      >
        {() => (
          <STTScreen
            audioFile={audioFile}
            onAudioFileChange={onAudioFileChange}
          />
        )}
      </Tab.Screen>

      <Tab.Screen
        name="Diarization"
        options={{ tabBarLabel: 'DIARIZATION' }}
      >
        {() => (
          <DiarizationScreen
            audioFile={audioFile}
            onAudioFileChange={onAudioFileChange}
          />
        )}
      </Tab.Screen>

      <Tab.Screen
        name="Orchestrator"
        options={{ tabBarLabel: 'ORCHESTRATOR' }}
      >
        {() => (
          <OrchestratorScreen
            audioFile={audioFile}
            onAudioFileChange={onAudioFileChange}
          />
        )}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#0f0f0f',
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    height: 52,
    paddingBottom: 0,
  },
  tabLabel: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    letterSpacing: 1.5,
    marginTop: 4,
  },
});
