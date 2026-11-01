import { useRef, useState, type ReactNode } from "react";
import { ScrollFadeViewport } from "@/components/ui/scroll-fade-viewport.js";
import type { ComposerPlanGroup } from "@/lib/composerPlanGroups.js";
import type { ModelSelectGroup } from "@/ModelConfigSelect.js";
import { isNoThoughtLevel } from "@/chat-input-toolbar/thoughtLevelOptions.js";
import { ComposerEffortHeading } from "@/chat-input-toolbar/ComposerEffortHeading.js";
import { ComposerProviderMenu } from "@/chat-input-toolbar/ComposerProviderMenu.js";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu.js";
import "@/chat-input-toolbar/composer-thought-slider.css";

const EFFORT_BUBBLES = [
  { top: 4, size: 2, duration: 2.6, delay: -0.4 },
  { top: 14, size: 3, duration: 3.2, delay: -2.1 },
  { top: 8, size: 4, duration: 2.8, delay: -1.1 },
  { top: 18, size: 2, duration: 3.6, delay: -0.8 },
  { top: 3, size: 3, duration: 3, delay: -2.5 },
  { top: 12, size: 2, duration: 3.4, delay: -1.7 },
  { top: 6, size: 3, duration: 3.1, delay: -0.9 },
  { top: 17, size: 4, duration: 2.9, delay: -2.3 },
  { top: 10, size: 2, duration: 3.5, delay: -0.2 },
  { top: 2, size: 2, duration: 2.7, delay: -1.8 },
  { top: 15, size: 3, duration: 3.3, delay: -1.2 },
  { top: 7, size: 4, duration: 3.6, delay: -3.1 },
];

const HIGHSPEED_BUBBLES = Array.from({ length: 32 }, (_, index) => ({
  ...EFFORT_BUBBLES[index % EFFORT_BUBBLES.length]!,
  duration: (8 + (index % 5)) / 10,
  delay: -index * 0.137,
}));

export interface ComposerModelOptions {
  providerMenu?: {
    groups: readonly ComposerPlanGroup[];
    selectedKey?: string;
    pending: boolean;
    error: string | null;
    onSelect: (group: ComposerPlanGroup) => void;
  };
  providerLabel: string;
  modelsLabel: string;
  effortLabel: string;
  effortShortcutLabel?: string;
  selectModelLabel: string;
  levels: readonly { value: string; label: string }[];
  value: string;
  onValueChange: (value: string) => void;
}

export function getComposerThoughtDisplay(options: ComposerModelOptions) {
  const current = options.levels.find((level) => level.value === options.value);
  const thinking = options.levels.filter((level) => !isNoThoughtLevel(level));
  const progress =
    current && !isNoThoughtLevel(current)
      ? ((thinking.findIndex((level) => level.value === current.value) + 1) / thinking.length) * 100
      : 0;
  return { label: current?.label ?? "—", progress };
}

export function isGlmHighspeedModel(name: string) {
  return /glm/i.test(name) && /highspeed|flashx/i.test(name);
}

export function ComposerThoughtIndicator({
  options,
  highspeed = false,
}: {
  options: ComposerModelOptions;
  highspeed?: boolean;
}) {
  const { label, progress } = getComposerThoughtDisplay(options);
  return (
    <>
      <span
        className="shrink-0 text-foreground-subtle group-data-[composer-compact=true]/combined:hidden"
        data-composer-thought-label
      >
        {label}
      </span>
      <span
        aria-hidden="true"
        data-testid="composer-thought-meter"
        data-highspeed={highspeed}
        data-progress={progress}
        className="relative hidden h-4 w-1 shrink-0 overflow-hidden rounded-full bg-foreground/10 group-data-[composer-compact=true]/combined:block"
      >
        <span
          className="composer-thought-meter-fill absolute bottom-0 left-0 w-full rounded-full bg-success"
          style={{ height: `${progress}%` }}
        />
      </span>
    </>
  );
}

export function ComposerModelMenu({
  groups,
  normalizedValue,
  options,
  renderItems,
  renderConnection,
  providerFooter,
  isItemLocked,
  onSelectModel,
}: {
  groups: readonly ModelSelectGroup[];
  normalizedValue: string;
  options: ComposerModelOptions;
  renderItems: (items: ModelSelectGroup["items"]) => ReactNode;
  renderConnection: (group: ModelSelectGroup) => ReactNode;
  providerFooter?: ReactNode;
  isItemLocked: (value: string) => boolean;
  onSelectModel: (value: string) => void;
}) {
  const [browse, setBrowse] = useState<{ key: string; selection: string } | null>(null);
  const menuGroups: readonly ComposerPlanGroup[] = options.providerMenu?.groups ?? groups;
  const selected =
    menuGroups.find((group) => group.key === options.providerMenu?.selectedKey) ??
    menuGroups.find((group) => group.items.some((item) => item.value === normalizedValue));
  const group =
    (browse?.selection === normalizedValue
      ? menuGroups.find((item) => item.key === browse.key)
      : undefined) ??
    selected ??
    menuGroups[0];
  const modelName = selected?.items.find((item) => item.value === normalizedValue)?.name ?? "";
  const highspeed = isGlmHighspeedModel(modelName);
  const currentGroupSelected = group?.key === selected?.key && Boolean(selected);
  const currentIndex = options.levels.findIndex((level) => level.value === options.value);
  const { label } = getComposerThoughtDisplay(options);
  const sliderRef = useRef<HTMLInputElement>(null);
  const catalogPending = groups.length === 0 && Boolean(normalizedValue);
  const showEffort = options.levels.length > 0 || catalogPending;
  const [hoveredStop, setHoveredStop] = useState<string | null>(null);
  const sliderDisabled =
    Boolean(options.providerMenu?.pending) || !currentGroupSelected || options.levels.length < 2;
  const sliderProgress =
    options.levels.length > 1 && currentIndex >= 0 && currentGroupSelected
      ? (currentIndex / (options.levels.length - 1)) * 100
      : 0;
  const sliderFilled =
    currentGroupSelected && currentIndex >= 0 && !isNoThoughtLevel(options.levels[currentIndex]!);
  const selectSliderValue = (index: number) => {
    const level = options.levels[index];
    if (!sliderDisabled && level && level.value !== options.value)
      options.onValueChange(level.value);
  };
  return (
    <>
      <ComposerProviderMenu
        groups={menuGroups}
        error={options.providerMenu?.error}
        disabled={options.providerMenu?.pending}
        loading={options.providerMenu?.pending}
        isDisabled={(candidate) => Boolean((candidate as ComposerPlanGroup).connection?.disabled)}
        separatorBeforeKey={
          options.providerMenu
            ? menuGroups.find(
                (candidate) =>
                  !candidate.connection && !candidate.key.startsWith("registry-provider:account:"),
              )?.key
            : undefined
        }
        group={group}
        label={options.providerLabel}
        providerFooter={providerFooter}
        onSelect={(candidate) => {
          if (options.providerMenu) {
            options.providerMenu.onSelect(candidate as ComposerPlanGroup);
            return;
          }
          setBrowse({ key: candidate.key, selection: normalizedValue });
          const model =
            candidate.items.find(
              (item) => item.value === normalizedValue && !isItemLocked(item.value),
            ) ?? candidate.items.find((item) => !isItemLocked(item.value));
          if (model && model.value !== normalizedValue) onSelectModel(model.value);
        }}
      >
        <DropdownMenuSeparator className="bg-border/50" />
        <DropdownMenuLabel className="text-ui-sm text-foreground-subtle">
          {options.modelsLabel}
        </DropdownMenuLabel>
        {group ? renderConnection(group) : null}
        <ScrollFadeViewport
          className="max-h-60 flex-initial"
          inert={options.providerMenu?.pending || undefined}
          data-composer-model-list
        >
          {group ? renderItems(group.items) : null}
        </ScrollFadeViewport>
        {showEffort ? (
          <>
            <DropdownMenuSeparator className="bg-border/50" />
            {options.levels.length === 1 ? (
              <div className="px-2 py-2">
                <ComposerEffortHeading
                  label={options.effortLabel}
                  value={currentGroupSelected ? label : "—"}
                />
              </div>
            ) : (
              <DropdownMenuItem
                className="block px-2 py-2 focus:bg-transparent"
                aria-disabled={sliderDisabled}
                onSelect={(event) => event.preventDefault()}
                onFocus={(event) => {
                  if (event.target === event.currentTarget) sliderRef.current?.focus();
                }}
              >
                <ComposerEffortHeading
                  label={options.effortLabel}
                  value={currentGroupSelected ? label : "—"}
                  shortcut={options.effortShortcutLabel}
                />
                <div
                  className="composer-thought-slider relative h-8 w-full rounded-full"
                  data-disabled={sliderDisabled}
                >
                  <div
                    key={JSON.stringify([
                      normalizedValue,
                      group?.key,
                      options.levels.map((level) => level.value),
                    ])}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0"
                  >
                    <div
                      data-testid="composer-thought-track"
                      data-progress={sliderFilled ? sliderProgress : 0}
                      className="absolute inset-x-0 top-1 h-6 overflow-hidden rounded-full bg-foreground/10"
                    >
                      {}
                      <div className="absolute inset-0 rounded-full border border-foreground/10" />
                      <div
                        className="composer-thought-slider-fill absolute inset-y-0 left-0 overflow-hidden rounded-full"
                        data-max={sliderFilled && currentIndex === options.levels.length - 1}
                        data-highspeed={highspeed && currentGroupSelected}
                        style={{
                          width: sliderFilled
                            ? `calc(14px + (100% - 28px) * ${sliderProgress / 100})`
                            : 0,
                        }}
                      >
                        {sliderFilled &&
                        currentIndex === options.levels.length - 1 &&
                        !sliderDisabled ? (
                          <div
                            data-testid="composer-thought-bubbles"
                            className="composer-thought-bubbles absolute inset-0"
                          >
                            {(highspeed ? HIGHSPEED_BUBBLES : EFFORT_BUBBLES).map(
                              (bubble, index) => (
                                <span
                                  key={index}
                                  className="composer-thought-bubble absolute inset-x-0"
                                  style={{
                                    top: bubble.top,
                                    animationDuration: `${bubble.duration}s`,
                                    animationDelay: `${bubble.delay}s`,
                                  }}
                                >
                                  <span
                                    className="block rounded-full bg-white"
                                    style={{ width: bubble.size, height: bubble.size }}
                                  />
                                </span>
                              ),
                            )}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="absolute inset-x-3.5 inset-y-0 flex items-center justify-between">
                      {options.levels.map((level, index) => (
                        <span
                          key={level.value}
                          data-composer-thought-stop
                          data-filled={sliderFilled && index <= currentIndex}
                          data-hovered={
                            !sliderDisabled && hoveredStop === `${normalizedValue}:${level.value}`
                          }
                          className="composer-thought-slider-stop size-1 shrink-0 rounded-full"
                        />
                      ))}
                    </div>
                    <div
                      className="composer-thought-slider-thumb absolute top-0.5 size-7 rounded-full shadow-sm"
                      style={{ left: `calc((100% - 28px) * ${sliderProgress / 100})` }}
                    />
                  </div>
                  <input
                    ref={sliderRef}
                    type="range"
                    min={0}
                    max={Math.max(0, options.levels.length - 1)}
                    step={1}
                    value={Math.max(0, currentIndex)}
                    aria-disabled={sliderDisabled}
                    aria-label={options.effortLabel}
                    aria-valuetext={currentGroupSelected ? label : "—"}
                    data-testid="composer-thought-slider"
                    data-levels={JSON.stringify(options.levels.map((level) => level.value))}
                    className="composer-thought-range absolute inset-0 m-0 h-8 w-full cursor-pointer appearance-none bg-transparent outline-none aria-disabled:cursor-default"
                    onPointerDown={(event) => {
                      if (sliderDisabled) event.preventDefault();
                    }}
                    onPointerLeave={() => setHoveredStop(null)}
                    onPointerMove={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      const trackWidth = rect.width - 28;
                      const index = Math.round(
                        ((event.clientX - rect.left - 14) / trackWidth) *
                          (options.levels.length - 1),
                      );
                      const level = options.levels[index];
                      const center =
                        rect.left + 14 + (trackWidth * index) / (options.levels.length - 1);
                      setHoveredStop(
                        !sliderDisabled &&
                          event.pointerType !== "touch" &&
                          level &&
                          Math.abs(event.clientX - center) <= 10
                          ? `${normalizedValue}:${level.value}`
                          : null,
                      );
                    }}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key !== "Escape") {
                        event.stopPropagation();
                        if (sliderDisabled && event.key !== "Tab") event.preventDefault();
                      }
                    }}
                    onKeyUp={(event) => {
                      if (
                        [
                          "Home",
                          "End",
                          "ArrowLeft",
                          "ArrowRight",
                          "ArrowUp",
                          "ArrowDown",
                          "PageUp",
                          "PageDown",
                        ].includes(event.key)
                      )
                        selectSliderValue(Number(event.currentTarget.value));
                    }}
                    onPointerUp={(event) => {
                      selectSliderValue(Number(event.currentTarget.value));
                    }}
                    onChange={(event) => selectSliderValue(Number(event.currentTarget.value))}
                  />
                </div>
              </DropdownMenuItem>
            )}
          </>
        ) : null}
      </ComposerProviderMenu>
    </>
  );
}
