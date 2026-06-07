import { Buffer } from 'buffer';
global.Buffer = Buffer;

import { registerRootComponent } from 'expo';
import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import TabNavigator from './navigation/TabNavigator';
import { AudioFile } from './types/benchmark';

/**
 * Root component.
 *
 * Audio state lives here and is passed down to both tab screens so that
 * picking a file in one tab is reflected in the other.
 */
export default function App() {
  const [audioFile, setAudioFile] = useState<AudioFile | null>(null);

  return (
    <SafeAreaProvider>
      <NavigationContainer
        theme={{
          dark: true,
          colors: {
            primary: '#00ff88',
            background: '#0a0a0a',
            card: '#0f0f0f',
            text: '#ffffff',
            border: '#222222',
            notification: '#00ff88',
          },
          fonts: {
            regular: { fontFamily: 'Courier New', fontWeight: '400' },
            medium:  { fontFamily: 'Courier New', fontWeight: '500' },
            bold:    { fontFamily: 'Courier New', fontWeight: '700' },
            heavy:   { fontFamily: 'Courier New', fontWeight: '900' },
          },
        }}
      >
        <StatusBar style="light" backgroundColor="#0a0a0a" />
        <TabNavigator
          audioFile={audioFile}
          onAudioFileChange={setAudioFile}
        />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

registerRootComponent(App);
