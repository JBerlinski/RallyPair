import 'react-native-gesture-handler';
import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';

import HomeScreen from './src/screens/HomeScreen';
import NavigatorScreen from './src/screens/NavigatorScreen';
import DriverPairingScreen from './src/screens/DriverPairingScreen';
import DriverMapScreen from './src/screens/DriverMapScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import { C } from './src/theme';

const Stack = createStackNavigator();
const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: C.bg, card: C.bg, text: C.text, border: C.bg } };

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaProvider>
        <NavigationContainer theme={theme} documentTitle={{ formatter: () => 'RallyPair' }}>
          <Stack.Navigator
            initialRouteName="Home"
            screenOptions={{
              headerStyle: { backgroundColor: C.bg, shadowOpacity: 0, elevation: 0 },
              headerTintColor: C.text,
              headerTitleStyle: { fontWeight: '700' },
              headerBackTitle: 'Wróć',
              cardStyle: { backgroundColor: C.bg },
            }}
          >
            <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Navigator" component={NavigatorScreen} options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="Driver" component={DriverPairingScreen} options={{ title: 'Dołącz jako kierowca' }} />
            <Stack.Screen name="DriverMap" component={DriverMapScreen} options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Ustawienia' }} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
