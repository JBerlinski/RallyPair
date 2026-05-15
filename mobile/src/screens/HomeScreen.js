import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar } from 'react-native';

export default function HomeScreen({ navigation }) {
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <Text style={styles.title}>RallyPair</Text>
      <Text style={styles.subtitle}>Wybierz swój tryb</Text>

      <TouchableOpacity
        style={[styles.btn, styles.btnNavigator]}
        onPress={() => navigation.navigate('Navigator')}
      >
        <Text style={styles.btnIcon}>🗺️</Text>
        <Text style={styles.btnLabel}>Nawigator</Text>
        <Text style={styles.btnHint}>Generujesz kod i wyznaczasz trasę</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.btn, styles.btnDriver]}
        onPress={() => navigation.navigate('Driver')}
      >
        <Text style={styles.btnIcon}>🚗</Text>
        <Text style={styles.btnLabel}>Kierowca</Text>
        <Text style={styles.btnHint}>Wpisujesz kod i widzisz mapę</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 42,
    fontWeight: '800',
    color: '#f1f5f9',
    letterSpacing: 1,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 16,
    color: '#94a3b8',
    marginBottom: 48,
  },
  btn: {
    width: '100%',
    borderRadius: 16,
    padding: 24,
    marginBottom: 16,
    alignItems: 'center',
  },
  btnNavigator: {
    backgroundColor: '#1e40af',
  },
  btnDriver: {
    backgroundColor: '#065f46',
  },
  btnIcon: {
    fontSize: 36,
    marginBottom: 8,
  },
  btnLabel: {
    fontSize: 22,
    fontWeight: '700',
    color: '#f1f5f9',
    marginBottom: 4,
  },
  btnHint: {
    fontSize: 13,
    color: '#cbd5e1',
    textAlign: 'center',
  },
});
