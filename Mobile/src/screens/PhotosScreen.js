import { useCallback, useEffect, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Image, Alert, ActivityIndicator, TextInput, Dimensions,
  RefreshControl, StatusBar,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { fetchPhotos, uploadPhoto, deletePhoto } from "../api";
import { useAuth } from "../context/AuthContext";
import { colors, radius } from "../theme";

const VIDEO_EXTS = new Set(["mp4", "mov", "avi", "mkv", "webm", "m4v"]);
const isVideo = (f) => VIDEO_EXTS.has(f.split(".").pop().toLowerCase());
const NUM_COLS = 3;
const ITEM_SIZE = (Dimensions.get("window").width - (NUM_COLS + 1) * 2) / NUM_COLS;

function groupByDate(photos) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today - 86400000);
  const weekAgo = new Date(today - 6 * 86400000);
  const groups = new Map();
  for (const p of photos) {
    const d = new Date(p.last_modified);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    let label;
    if (day >= today) label = "Today";
    else if (day >= yesterday) label = "Yesterday";
    else if (day >= weekAgo) label = "This week";
    else label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(p);
  }
  // Flatten into FlatList-compatible sections: header items + photo items
  const flat = [];
  for (const [label, items] of groups.entries()) {
    flat.push({ type: "header", label });
    // Chunk items into rows of NUM_COLS
    for (let i = 0; i < items.length; i += NUM_COLS) {
      flat.push({ type: "row", items: items.slice(i, i + NUM_COLS) });
    }
  }
  return flat;
}

export default function PhotosScreen({ navigation }) {
  const { user, signOut } = useAuth();
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    try { setPhotos(await fetchPhotos()); }
    catch { Alert.alert("Error", "Could not load photos. Is the backend running?"); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const pickAndUpload = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Please allow media access in Settings.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsMultipleSelection: true,
      quality: 0.9,
    });
    if (result.canceled) return;

    setUploading(true);
    for (const asset of result.assets) {
      const filename = asset.fileName ?? asset.uri.split("/").pop();
      const mime = asset.mimeType ?? (isVideo(filename) ? "video/mp4" : "image/jpeg");
      try {
        await uploadPhoto(asset.uri, filename, mime, setProgress);
      } catch (e) {
        Alert.alert("Upload failed", e.message);
      }
    }
    setUploading(false);
    setProgress(0);
    load();
  };

  const confirmDelete = (photo) => {
    Alert.alert(
      "Delete photo?",
      photo.filename,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: async () => {
            try {
              await deletePhoto(photo.key);
              setPhotos((prev) => prev.filter((p) => p.key !== photo.key));
            } catch (e) {
              Alert.alert("Error", e.message);
            }
          },
        },
      ],
    );
  };

  const filtered = photos.filter((p) =>
    p.filename.toLowerCase().includes(search.toLowerCase())
  );
  const listData = groupByDate(filtered);

  const renderItem = ({ item }) => {
    if (item.type === "header") {
      return (
        <View style={styles.dateHeader}>
          <Text style={styles.dateLabel}>{item.label}</Text>
        </View>
      );
    }
    return (
      <View style={styles.row}>
        {item.items.map((p) => (
          <TouchableOpacity
            key={p.key}
            style={styles.cell}
            onPress={() => navigation.navigate("Viewer", { photo: p, photos: filtered })}
            onLongPress={() => confirmDelete(p)}
            activeOpacity={0.8}
          >
            <Image source={{ uri: p.url }} style={styles.thumb} />
            {isVideo(p.filename) && (
              <View style={styles.playBadge}>
                <Ionicons name="play" size={14} color="#fff" />
              </View>
            )}
          </TouchableOpacity>
        ))}
        {/* Fill empty cells in last row */}
        {Array.from({ length: NUM_COLS - item.items.length }).map((_, i) => (
          <View key={`empty-${i}`} style={[styles.cell, styles.cellEmpty]} />
        ))}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />

      {/* Top bar */}
      <LinearGradient
        colors={["rgba(17,19,24,0.98)", "rgba(17,19,24,0.0)"]}
        style={styles.topbar}
      >
        <View style={styles.logoRow}>
          <LinearGradient colors={["#7c6cf8", "#c084fc"]} style={styles.logoIcon}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
            <Ionicons name="cloud" size={16} color="#fff" />
          </LinearGradient>
          <Text style={styles.logoText}>MAZZ-terpieces</Text>
        </View>

        <TouchableOpacity onPress={() => setMenuOpen((o) => !o)} style={styles.avatarBtn}>
          {user?.picture ? (
            <Image source={{ uri: user.picture }} style={styles.avatarImg} />
          ) : (
            <LinearGradient colors={["#7c6cf8", "#c084fc"]} style={styles.avatarFallback}>
              <Text style={styles.avatarLetter}>{user?.name?.[0]?.toUpperCase()}</Text>
            </LinearGradient>
          )}
        </TouchableOpacity>
      </LinearGradient>

      {/* User dropdown */}
      {menuOpen && (
        <TouchableOpacity style={styles.menuOverlay} onPress={() => setMenuOpen(false)} activeOpacity={1}>
          <View style={styles.menuCard}>
            <View style={styles.menuProfile}>
              {user?.picture ? (
                <Image source={{ uri: user.picture }} style={styles.menuAvatar} />
              ) : (
                <LinearGradient colors={["#7c6cf8", "#c084fc"]} style={[styles.menuAvatar, { alignItems: "center", justifyContent: "center" }]}>
                  <Text style={{ color: "#fff", fontWeight: "700" }}>{user?.name?.[0]}</Text>
                </LinearGradient>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.menuName}>{user?.name}</Text>
                <Text style={styles.menuEmail} numberOfLines={1}>{user?.email}</Text>
              </View>
            </View>
            <View style={styles.menuDivider} />
            <TouchableOpacity style={styles.signOutBtn} onPress={signOut}>
              <Ionicons name="log-out-outline" size={18} color={colors.textDim} />
              <Text style={styles.signOutText}>Sign out</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      )}

      {/* Search bar */}
      <View style={styles.searchRow}>
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color={colors.textDim} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search photos, videos…"
            placeholderTextColor={colors.textDim}
            value={search}
            onChangeText={setSearch}
          />
          {search !== "" && (
            <TouchableOpacity onPress={() => setSearch("")}>
              <Ionicons name="close-circle" size={16} color={colors.textDim} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accentPurple} />
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(item, i) => item.label ?? `row-${i}`}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={colors.accentPurple}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="images-outline" size={52} color={colors.textDim} />
              <Text style={styles.emptyTitle}>
                {search ? `No results for "${search}"` : "No photos yet"}
              </Text>
              {!search && (
                <Text style={styles.emptySub}>Tap Upload to add your first photo or video.</Text>
              )}
            </View>
          }
        />
      )}

      {/* Upload FAB */}
      <TouchableOpacity
        style={[styles.fab, uploading && styles.fabDisabled]}
        onPress={pickAndUpload}
        disabled={uploading}
        activeOpacity={0.85}
      >
        <LinearGradient
          colors={uploading ? [colors.surface2, colors.surface2] : [colors.yellow, colors.yellowHover]}
          style={styles.fabGradient}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        >
          {uploading ? (
            <>
              <ActivityIndicator size="small" color={colors.yellowText} />
              <Text style={styles.fabText}>{progress}%</Text>
            </>
          ) : (
            <>
              <Ionicons name="add" size={22} color={colors.yellowText} />
              <Text style={styles.fabText}>Upload</Text>
            </>
          )}
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 52,
    paddingBottom: 12,
  },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  logoIcon: {
    width: 30, height: 30, borderRadius: 8,
    alignItems: "center", justifyContent: "center",
  },
  logoText: { fontSize: 16, fontWeight: "800", color: "#a78bfa" },
  avatarBtn: { padding: 2 },
  avatarImg: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: colors.borderBright },
  avatarFallback: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: colors.borderBright,
  },
  avatarLetter: { color: "#fff", fontWeight: "700", fontSize: 14 },

  // User dropdown
  menuOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 100,
  },
  menuCard: {
    position: "absolute", top: 100, right: 14,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.borderBright,
    width: 230,
    shadowColor: "#000", shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4, shadowRadius: 20, elevation: 10,
    overflow: "hidden",
  },
  menuProfile: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14 },
  menuAvatar: { width: 40, height: 40, borderRadius: 20 },
  menuName: { fontSize: 14, fontWeight: "600", color: colors.textBright },
  menuEmail: { fontSize: 11, color: colors.textDim, marginTop: 1 },
  menuDivider: { height: 1, backgroundColor: colors.border },
  signOutBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 14,
  },
  signOutText: { fontSize: 14, color: colors.textDim },

  // Search
  searchRow: { paddingHorizontal: 12, paddingBottom: 10 },
  searchWrap: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: colors.surface2,
    borderRadius: 999, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 8, gap: 8,
  },
  searchIcon: {},
  searchInput: {
    flex: 1, fontSize: 14, color: colors.textBright,
    padding: 0,
  },

  // Grid
  list: { paddingHorizontal: 2, paddingBottom: 100 },
  dateHeader: { paddingHorizontal: 10, paddingVertical: 8, marginTop: 8 },
  dateLabel: {
    fontSize: 11, fontWeight: "700", color: colors.textDim,
    textTransform: "uppercase", letterSpacing: 0.8,
  },
  row: { flexDirection: "row", gap: 2, marginBottom: 2 },
  cell: { width: ITEM_SIZE, height: ITEM_SIZE, backgroundColor: colors.surface2 },
  cellEmpty: { backgroundColor: "transparent" },
  thumb: { width: "100%", height: "100%", resizeMode: "cover" },
  playBadge: {
    position: "absolute", bottom: 6, right: 6,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 99, padding: 4,
  },

  // States
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  loadingText: { color: colors.textDim, fontSize: 14 },
  empty: { alignItems: "center", gap: 12, marginTop: 80, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 17, fontWeight: "600", color: colors.textBright, textAlign: "center" },
  emptySub: { fontSize: 13, color: colors.textDim, textAlign: "center", lineHeight: 19 },

  // FAB
  fab: {
    position: "absolute", bottom: 28, right: 20,
    borderRadius: 999,
    shadowColor: colors.yellow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 6,
  },
  fabDisabled: { shadowColor: "transparent" },
  fabGradient: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 20, paddingVertical: 13,
    borderRadius: 999,
  },
  fabText: { fontSize: 14, fontWeight: "700", color: colors.yellowText },
});
