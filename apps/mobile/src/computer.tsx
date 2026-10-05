import {
  FileText,
  FolderOpen,
  Globe2,
  Monitor,
  Plus,
  RefreshCw,
  Terminal,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { AppState, Image, Pressable, Text, View } from "react-native";
import type { BrowserSession } from "../../../packages/domain/src";
import { browserAddress } from "./browser-address";
import { useComputerDraft } from "./computer-drafts";
import { LinuxWorkspace } from "./computer-workspace";
import { isRhodizPc, rhodizPcTabs, rhodizPcWorkspaceConnected } from "./rhodiz-pc";
import { Button, Card, colors, ErrorNotice, Field, LinkRow, Sheet, s } from "./ui";
import { useWorkspace } from "./workspace";

export function ComputerEntry() {
  const { workspace, open } = useWorkspace();
  const available = workspace.connections.some(
    (c) => c.id === "browser" && c.status === "connected",
  );
  const sovereign = workspace.runtime.browserBackend === "rhodiz";
  const rhodizPc = isRhodizPc(workspace.runtime);
  const active = workspace.browsers.filter((b) => b.status === "active").length;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={rhodizPc ? "RHODIZ PC — take control" : "Agent computer — take control"}
      onPress={() => open({ type: "computer" })}
      style={[
        s.row,
        {
          alignSelf: "center",
          gap: 6,
          paddingHorizontal: 12,
          paddingVertical: 7,
          borderRadius: 20,
          backgroundColor: "#F1F3F4",
        },
      ]}
    >
      <Monitor size={13} color={colors.muted} />
      <Text style={{ fontSize: 12, color: colors.muted }}>
        {rhodizPc ? "RHODIZ PC" : "Computer"}
        {sovereign
          ? available
            ? " · RHODIZ online"
            : " · RHODIZ offline"
          : active
            ? " · take control"
            : available
              ? " · ready"
              : " · offline"}
      </Text>
      <View
        style={{
          width: 5,
          height: 5,
          borderRadius: 3,
          backgroundColor: available ? "#57AD85" : "#ACB0B5",
        }}
      />
    </Pressable>
  );
}
export function BrowserThreadCard({ browser }: { browser: BrowserSession }) {
  const { open, workspace, api } = useWorkspace();
  const sovereign = workspace.runtime.browserBackend === "rhodiz";
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [browser.previewUrl, browser.updatedAt]);
  return (
    <Card
      style={{ padding: 13, backgroundColor: "#EEEEF0", gap: 12, maxWidth: 440, width: "100%" }}
    >
      <View style={[s.row, { gap: 10 }]}>
        <View style={[s.iconBox, { width: 36, height: 36, borderRadius: 9 }]}>
          <Globe2 size={21} color={colors.blueDark} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.text, { fontWeight: "600" }]}>Browser</Text>
          <Text numberOfLines={1} style={s.small}>
            {browser.status === "closed"
              ? "Session saved"
              : browser.status === "error"
                ? "Needs attention"
                : browser.title}
          </Text>
        </View>
      </View>
      {browser.previewUrl && browser.status === "active" && !failed ? (
        <Image
          accessibilityLabel={`Browser preview: ${browser.title}`}
          source={{
            uri: api.url(browser.previewUrl),
            ...(sovereign ? { headers: { Authorization: `Bearer ${api.token}` } } : {}),
          }}
          style={{ width: "100%", aspectRatio: 1.6, borderRadius: 11, backgroundColor: "#FFF" }}
          resizeMode="contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <View
          style={{
            padding: 24,
            borderRadius: 12,
            backgroundColor: "#FFF",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Globe2 size={30} color={colors.muted} />
          <Text numberOfLines={2} style={[s.muted, { textAlign: "center" }]}>
            {failed ? "Preview unavailable. Open the browser to reconnect." : browser.url}
          </Text>
        </View>
      )}
      <Button onPress={() => open({ type: "browser", browser })}>
        {sovereign
          ? "Open RHODIZ takeover"
          : browser.status === "closed"
            ? "Reopen browser"
            : browser.status === "error"
              ? "Reconnect browser"
              : "Take control"}
      </Button>
    </Card>
  );
}
export function ComputerSheet() {
  const { workspace, api, refresh, close, open, navigate } = useWorkspace();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useComputerDraft("tab");
  const available = workspace.connections.some(
    (c) => c.id === "browser" && c.status === "connected",
  );
  const sovereign = workspace.runtime.browserBackend === "rhodiz";
  const browserStatus = workspace.runtime.browserStatus;
  const rhodizPc = isRhodizPc(workspace.runtime);
  const pcWorkspaceConnected = rhodizPcWorkspaceConnected(workspace.runtime);
  const effectiveTab = rhodizPc && !pcWorkspaceConnected ? "Browser" : tab;
  useEffect(() => {
    let active = true;
    const timer = setInterval(() => {
      if (AppState.currentState !== "active") return;
      void refresh().catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    }, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refresh]);
  async function create() {
    if (busy || !available || !url.trim()) return;
    setBusy(true);
    setError("");
    try {
      const target = browserAddress(url);
      const browser = sovereign
        ? await api.request<BrowserSession>("/api/rhodiz-browser/sessions", {})
        : await api.request<BrowserSession>("/api/browsers", { url: target });
      await refresh();
      open({ type: "browser", browser: sovereign ? { ...browser, url: target } : browser });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title={rhodizPc ? "RHODIZ PC" : "Agent computer"}
      subtitle={
        rhodizPc
          ? "RHODIZ’s governed PC workspace and tools."
          : "Your agent works here. Step in whenever you need."
      }
      onClose={close}
    >
      <View style={{ gap: 20 }}>
        {effectiveTab === "Browser" && (
          <View
            style={[s.row, { gap: 12, padding: 18, borderRadius: 20, backgroundColor: colors.sky }]}
          >
            <Monitor size={28} color={colors.blueDark} />
            <View style={{ flex: 1 }}>
              <Text style={s.heading}>
                {sovereign
                  ? available
                    ? "RHODIZ browser online"
                    : browserStatus === "forbidden"
                      ? "RHODIZ browser restricted"
                      : "RHODIZ browser offline"
                  : available
                    ? "Browser connected"
                    : "Browser offline"}
              </Text>
              <Text style={s.muted}>
                {sovereign
                  ? available
                    ? "The canonical RHODIZ browser is healthy. Navigation is gated by one-shot RHODIZ Action Fabric confirmation tickets."
                    : browserStatus === "forbidden"
                      ? "This RHODIZ account is not authorized for the RHODIZ PC browser."
                      : browserStatus === "disabled"
                        ? "Enable the RHODIZ PC browser from its canonical Admin configuration."
                        : "The RHODIZ PC browser is configured but its sidecar is unavailable."
                  : available
                    ? "Your agent’s browser and documents, in one place."
                    : "Start the browser worker to connect this computer."}
              </Text>
            </View>
          </View>
        )}
        <View style={[s.row, { gap: 8 }]}>
          {rhodizPcTabs(workspace.runtime).map((item) => (
            <Button
              key={item}
              primary={tab === item}
              icon={item === "Browser" ? Globe2 : item === "Terminal" ? Terminal : FolderOpen}
              onPress={() => setTab(item)}
            >
              {item}
            </Button>
          ))}
        </View>
        <View style={{ display: effectiveTab === "Browser" ? "none" : "flex" }}>
          <LinuxWorkspace tab={effectiveTab === "Files" ? "Files" : "Terminal"} />
        </View>
        <ErrorNotice error={error} />
        {effectiveTab === "Browser" ? (
          <>
            <View>
              <Field
                label="Website address"
                value={url}
                onChangeText={setUrl}
                placeholder="https://example.com"
                autoCapitalize="none"
                keyboardType="url"
                onSubmitEditing={() => void create()}
              />
              <Button
                primary
                icon={Plus}
                busy={busy}
                disabled={!available || !url.trim()}
                onPress={() => void create()}
              >
                {sovereign ? "Create RHODIZ session" : "Open a browser session"}
              </Button>
            </View>
            {[...workspace.browsers]
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
              .map((browser) => (
                <BrowserThreadCard key={browser.id} browser={browser} />
              ))}
            {!workspace.browsers.length && (
              <Text style={s.muted}>
                Open a page here or ask your agent to research something. Its browsing sessions will
                appear here.
              </Text>
            )}
            <Text style={s.small}>
              {sovereign
                ? "Browser state and effects come from RHODIZ. OpenMuse relays explicit confirmation tickets but never authorizes an effect itself."
                : "Browsing sessions keep their own logins and downloads. Open one to take over, then return to your conversation."}
            </Text>
          </>
        ) : tab === "Files" ? (
          <>
            <Text style={s.heading}>Documents</Text>
            <Text style={s.small}>PDFs saved from mail, browser downloads, and your uploads.</Text>
            {workspace.files.map((file) => (
              <LinkRow
                key={file.id}
                icon={FileText}
                title={file.name}
                detail={`${file.pageCount} pages · PDF`}
                onPress={() => open({ type: "file", file })}
              />
            ))}
            <Button
              icon={Plus}
              onPress={() => {
                close();
                navigate("files");
              }}
            >
              Import a document
            </Button>
          </>
        ) : null}
        <Button
          small
          icon={RefreshCw}
          onPress={() =>
            void refresh()
              .then(() => setError(""))
              .catch((e) => setError(String(e)))
          }
        >
          {rhodizPc ? "Refresh RHODIZ PC" : "Refresh computer"}
        </Button>
      </View>
    </Sheet>
  );
}
