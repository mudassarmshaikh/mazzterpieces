import { createContext, useContext, useEffect, useState } from "react";
import { GoogleSignin, statusCodes } from "@react-native-google-signin/google-signin";
import * as SecureStore from "expo-secure-store";

const WEB_CLIENT_ID = "479262304753-v86lsqll0mvhkdegma72lf0qur6b5edp.apps.googleusercontent.com";

GoogleSignin.configure({ webClientId: WEB_CLIENT_ID, offlineAccess: false });

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore session from secure storage on mount
  useEffect(() => {
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync("gid_user");
        if (stored) setUser(JSON.parse(stored));
      } catch (_) {}
      setLoading(false);
    })();
  }, []);

  const signIn = async () => {
    await GoogleSignin.hasPlayServices();
    const response = await GoogleSignin.signIn();

    // SDK v16 returns { type, data } — handle both shapes
    const userInfo = response.data?.user ?? response.user;
    const idToken = response.data?.idToken ?? response.idToken;

    if (!idToken) throw new Error("No ID token returned from Google Sign-In.");

    const profile = {
      sub: userInfo.id,
      email: userInfo.email,
      name: userInfo.name,
      picture: userInfo.photo,
    };

    await SecureStore.setItemAsync("gid_token", idToken);
    await SecureStore.setItemAsync("gid_user", JSON.stringify(profile));
    setUser(profile);
  };

  const signOut = async () => {
    await GoogleSignin.signOut();
    await SecureStore.deleteItemAsync("gid_token");
    await SecureStore.deleteItemAsync("gid_user");
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, statusCodes }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
