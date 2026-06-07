#!/usr/bin/env node
// Patches react-native-vosk's NativeVosk.ts to remove CodegenTypes.EventEmitter
// fields which are not supported by RN 0.76 codegen (old arch).
// Run automatically via postinstall.
const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '../node_modules/react-native-vosk/src/NativeVosk.ts');
if (!fs.existsSync(target)) {
  console.log('patch-vosk: file not found, skipping');
  process.exit(0);
}

const original = fs.readFileSync(target, 'utf8');
if (original.includes('readonly onError: EventEmitter')) {
  console.log('patch-vosk: already patched, skipping');
  process.exit(0);
}

const patched = `import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';
import type { EventEmitter } from 'react-native/Libraries/Types/CodegenTypes';

export type VoskOptions = {
  grammar?: string[];
  timeout?: number;
};

export interface Spec extends TurboModule {
  loadModel: (path: string) => Promise<void>;
  unload: () => void;

  start: (options?: VoskOptions) => Promise<void>;
  stop: () => void;

  addListener: (eventType: string) => void;
  removeListeners: (count: number) => void;

  readonly onError: EventEmitter<string>;
  readonly onResult: EventEmitter<string>;
  readonly onPartialResult: EventEmitter<string>;
  readonly onFinalResult: EventEmitter<string>;
  readonly onTimeout: EventEmitter<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('Vosk');
`;

fs.writeFileSync(target, patched, 'utf8');
console.log('patch-vosk: patched NativeVosk.ts successfully');
