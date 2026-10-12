import { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Image, Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { colors, radius } from "../theme";

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleSignIn = async () => {
    setLoading(true);
    try {
      await signIn();
    } catch (e) {
      if (e.code !== "SIGN_IN_CANCELLED") {
        Alert.alert("Sign-in failed", e.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient colors={["#0d0f1a", "#1a1035"]} style={styles.container}>
      {/* Glow orb */}
      <View style={styles.glow} />

      {/* Logo */}
      <View style={styles.logoRow}>
        <LinearGradient
          colors={["#7c6cf8", "#c084fc"]}
          style={styles.logoIcon}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        >
          <Ionicons name="cloud" size={22} color="#fff" />
        </LinearGradient>
        <Text style={styles.logoText}>MAZZ-terpieces</Text>
      </View>

      {/* Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Your personal media vault</Text>
        <Text style={styles.cardSub}>
          Sign in with your Google account to access your photos and videos from anywhere.
        </Text>

        <View style={styles.divider} />

        <TouchableOpacity
          style={[styles.googleBtn, loading && styles.googleBtnDisabled]}
          onPress={handleSignIn}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color="#18140a" size="small" />
          ) : (
            <>
              <Image
                source={{ uri: "https://developers.google.com/identity/images/g-logo.png" }}
                style={styles.googleLogo}
              />
              <Text style={styles.googleBtnText}>Sign in with Google</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={styles.noteRow}>
          <Ionicons name="lock-closed" size={13} color={colors.accentPurple} />
          <Text style={styles.noteText}>Your media is private and only visible to you.</Text>
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  glow: {
    position: "absolute",
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: "rgba(124,108,248,0.12)",
    top: "20%",
    alignSelf: "center",
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 32,
  },
  logoIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: {
    fontSize: 22,
    fontWeight: "800",
    color: "#a78bfa",
    letterSpacing: -0.5,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: 28,
    width: "100%",
    maxWidth: 360,
    borderWidth: 1,
    borderColor: colors.borderBright,
    alignItems: "center",
    gap: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.5,
    shadowRadius: 40,
    elevation: 12,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textBright,
    textAlign: "center",
  },
  cardSub: {
    fontSize: 13,
    color: colors.textDim,
    textAlign: "center",
    lineHeight: 19,
  },
  divider: {
    width: "100%",
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: colors.yellow,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 28,
    width: "100%",
    shadowColor: colors.yellow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  },
  googleBtnDisabled: { opacity: 0.6 },
  googleLogo: { width: 20, height: 20, resizeMode: "contain" },
  googleBtnText: {
    color: colors.yellowText,
    fontSize: 15,
    fontWeight: "700",
  },
  noteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  noteText: {
    fontSize: 11,
    color: colors.textDim,
  },
});
