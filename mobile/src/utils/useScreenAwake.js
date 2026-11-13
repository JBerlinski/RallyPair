import { useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { loadSettings } from './settings';

const TAG = 'rallypair-session';

// Keeps the display on while the screen is focused (unless switched off in settings).
export function useScreenAwake() {
  useFocusEffect(useCallback(() => {
    let active = true;
    loadSettings().then((s) => {
      if (active && s.keepAwake) activateKeepAwakeAsync(TAG).catch(() => {});
    });
    return () => {
      active = false;
      deactivateKeepAwake(TAG).catch(() => {});
    };
  }, []));
}
