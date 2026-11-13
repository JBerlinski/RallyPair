import { useEffect, useState } from 'react';
import { Keyboard, Platform, Dimensions } from 'react-native';

// How far a bottom-anchored panel has to be lifted to sit right above the keyboard (0 when it is hidden).
//
// Replaces KeyboardAvoidingView, which on edge-to-edge Android compares its full-screen frame with a
// keyboard position that excludes the navigation bar — so even with the keyboard closed it shrinks
// the panel by the nav bar's height and leaves a gap under it.
export function useKeyboardInset(bottomInset = 0) {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const ios = Platform.OS === 'ios';
    const baseHeight = Dimensions.get('window').height;

    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) => {
      const kb = e?.endCoordinates?.height || 0;
      // Android reports the keyboard without the system bars it covers; iOS includes the home indicator.
      const fromScreenBottom = ios ? kb : kb + bottomInset;
      // If the OS already resized the window for the keyboard, only cover what is left.
      const shrunk = Math.max(0, baseHeight - Dimensions.get('window').height);
      setInset(Math.max(0, fromScreenBottom - shrunk));
    });
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setInset(0));
    return () => { show.remove(); hide.remove(); };
  }, [bottomInset]);

  return inset;
}
