import 'react-native-gesture-handler';
import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';

import HomeScreen from './src/screens/HomeScreen';
import NavigatorScreen from './src/screens/NavigatorScreen';
import DriverPairingScreen from './src/screens/DriverPairingScreen';
import DriverMapScreen from './src/screens/DriverMapScreen';
import SettingsScreen from './src/screens/SettingsScreen';

const Stack = createStackNavigator();

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName="Home"
          screenOptions={{
            headerStyle: { backgroundColor: '#0f172a' },
            headerTintColor: '#f1f5f9',
            headerTitleStyle: { fontWeight: '700' },
            cardStyle: { backgroundColor: '#0f172a' },
          }}
        >
          <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Navigator" component={NavigatorScreen} options={{ title: 'Nawigator' }} />
          <Stack.Screen name="Driver" component={DriverPairingScreen} options={{ title: 'Kierowca — Dołącz' }} />
          <Stack.Screen
            name="DriverMap"
            component={DriverMapScreen}
            options={{ headerShown: false, gestureEnabled: false }}
          />
          <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Ustawienia' }} />
        </Stack.Navigator>
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}
