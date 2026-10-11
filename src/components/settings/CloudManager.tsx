import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getSettings, setSettings } from "@/lib/ipc";
import { PROVIDERS, type ProviderId } from "@/lib/providers";

/** Optional cloud provider, used instead of the local model when switched on. */
export function CloudManager() {
  const [provider, setProvider] = useState<ProviderId>("openrouter");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [useCloud, setUseCloud] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyId = useId();
  const modelId = useId();
  const switchId = useId();

  useEffect(() => {
    getSettings()
      .then(({ cloud, use_cloud }) => {
        if (cloud && cloud.provider in PROVIDERS) setProvider(cloud.provider as ProviderId);
        setApiKey(cloud?.api_key ?? "");
        setModel(cloud?.model ?? "");
        setUseCloud(use_cloud);
        setSaved(!!cloud);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const complete = apiKey.trim() !== "" && model.trim() !== "";

  /** Read fresh settings: the other managers change theirs. */
  async function save(cloudOn: boolean) {
    setError(null);
    try {
      const cloud = complete ? { provider, api_key: apiKey.trim(), model: model.trim() } : null;
      await setSettings({ ...(await getSettings()), cloud, use_cloud: cloudOn && !!cloud });
      setUseCloud(cloudOn && !!cloud);
      setSaved(!!cloud);
    } catch (e) {
      setError(`Could not save the provider: ${e}`);
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="cloud-heading">
      <div>
        <h2 id="cloud-heading" className="font-semibold">
          Cloud provider
        </h2>
        <p className="text-muted-foreground text-xs">
          Optional. Your questions and the doc passages are sent to the provider, and the API key is
          stored on this computer. Leave it off to stay fully offline.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label>Provider</Label>
          <Select value={provider} onValueChange={(v) => setProvider(v as ProviderId)}>
            <SelectTrigger aria-label="Provider" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PROVIDERS).map(([id, p]) => (
                <SelectItem key={id} value={id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={keyId}>API key</Label>
          <Input
            id={keyId}
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={modelId}>Model</Label>
          <Input
            id={modelId}
            placeholder={`e.g. ${PROVIDERS[provider].modelExample}`}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        </div>
        <Button size="sm" variant="outline" onClick={() => save(useCloud)} disabled={!complete}>
          Save
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Switch id={switchId} checked={useCloud} disabled={!saved} onCheckedChange={save} />
        <Label htmlFor={switchId}>Answer with this provider instead of the local model</Label>
      </div>
    </section>
  );
}
