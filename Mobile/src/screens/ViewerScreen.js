import { useState } from "react";
import {
  View, Text, Image, StyleSheet, TouchableOpacity,
  Dimensions, Alert, StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { deletePhoto } from "../api";
import { colors, radius } from "../theme";

const VIDEO_EXTS = new Set(["mp4", "mov", "avi", "mkv", "webm", "m4v"]);
const isVideo = (f) => VIDEO_EXTS.has(f.split(".").pop().toLowerCase());
const { width: W, height: H } = Dimensions.get("window");

export default function ViewerScreen({ route, navigation }) {
  const { photo, photos } = route.params;
  const [currentIndex, setCurrentIndex] = useState(
    photos.findIndex((p) => p.key === photo.key)
  );
  const current = photos[currentIndex];

  const goPrev = () => currentIndex > 0 && setCurrentIndex(currentIndex - 1);
  const goNext = () => currentIndex < photos.length - 1 && setCurrentIndex(currentIndex + 1);

  const confirmDelete = () => {
    Alert.alert(
      "Delete this item?",
      current.filename,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: async () => {
            try {
              await deletePhoto(current.key);
              navigation.goBack();
            } catch (e) {
              Alert.alert("Error", e.message);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      {/* Close */}
      <TouchableOpacity style={styles.closeBtn} onPress={() => navigation.goBack()}>
        <Ionicons name="close" size={22} color="#fff" />
      </TouchableOpacity>

      {/* Image / video placeholder */}
      <View style={styles.mediaWrap}>
        {isVideo(current.filename) ? (
          <View style={styles.videoPlaceholder}>
            <Ionicons name="videocam" size={48} color={colors.accentPurple2} />
            <Text style={styles.videoNote}>{current.filename}</Text>
            <Text style={styles.videoSub}>Video playback requires a native build</Text>
          </View>
        ) : (
          <Image
            source={{ uri: current.url }}
            style={styles.image}
            resizeMode="contain"
          />
        )}
      </View>

      {/* Prev / Next */}
      {currentIndex > 0 && (
        <TouchableOpacity style={styles.prevBtn} onPress={goPrev}>
          <Ionicons name="chevron-back" size={28} color={colors.yellowText} />
        </TouchableOpacity>
      )}
      {currentIndex < photos.length - 1 && (
        <TouchableOpacity style={styles.nextBtn} onPress={goNext}>
          <Ionicons name="chevron-forward" size={28} color={colors.yellowText} />
        </TouchableOpacity>
      )}

      {/* Info bar */}
      <View style={styles.infoBar}>
        <View style={styles.infoMeta}>
          <Ionicons
            name={isVideo(current.filename) ? "videocam-outline" : "image-outline"}
            size={16} color={colors.textDim}
          />
          <Text style={styles.filename} numberOfLines={1}>{current.filename}</Text>
          <Text style={styles.filesize}>{(current.size / 1024).toFixed(1)} KB</Text>
        </View>
        <TouchableOpacity style={styles.deleteBtn} onPress={confirmDelete}>
          <Ionicons name="trash-outline" size={16} color={colors.danger} />
          <Text style={styles.deleteText}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  closeBtn: {
    position: "absolute", top: 16, right: 16, zIndex: 20,
    backgroundColor: colors.yellow,
    borderRadius: 999, width: 36, height: 36,
    alignItems: "center", justifyContent: "center",
    shadowColor: colors.yellow, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4, shadowRadius: 8, elevation: 4,
  },
  mediaWrap: {
    flex: 1, alignItems: "center", justifyContent: "center",
  },
  image: { width: W, height: H * 0.8 },
  videoPlaceholder: {
    alignItems: "center", gap: 12, padding: 32,
  },
  videoNote: { color: colors.textBright, fontSize: 14, fontWeight: "600" },
  videoSub: { color: colors.textDim, fontSize: 12, textAlign: "center" },

  prevBtn: {
    position: "absolute", left: 12, top: "45%",
    backgroundColor: colors.yellow, borderRadius: 999,
    width: 40, height: 40, alignItems: "center", justifyContent: "center",
    shadowColor: colors.yellow, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35, shadowRadius: 8, elevation: 4,
  },
  nextBtn: {
    position: "absolute", right: 12, top: "45%",
    backgroundColor: colors.yellow, borderRadius: 999,
    width: 40, height: 40, alignItems: "center", justifyContent: "center",
    shadowColor: colors.yellow, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35, shadowRadius: 8, elevation: 4,
  },

  infoBar: {
    backgroundColor: "rgba(28,30,38,0.92)",
    borderTopWidth: 1, borderTopColor: colors.border,
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12,
    gap: 10,
  },
  infoMeta: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  filename: { flex: 1, fontSize: 13, color: colors.textBright, fontWeight: "500" },
  filesize: { fontSize: 11, color: colors.textDim, flexShrink: 0 },
  deleteBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: colors.dangerDim,
    borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 7,
  },
  deleteText: { color: colors.danger, fontSize: 13, fontWeight: "600" },
});
