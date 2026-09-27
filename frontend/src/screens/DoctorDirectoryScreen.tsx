import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  filterDirectory,
  loadDoctorDirectory,
  type DirectoryDoctor,
  type DirectoryFilter,
} from '../api/directory';
import { profileCopy } from '../theme/profileCopy';
import { space } from '../theme/spacing';
import { colors } from '../theme/colors';
import { themeForSpecialty } from '../theme/specialtyThemes';
import { Avatar } from '../components/Avatar';

type Props = {
  filter: DirectoryFilter;
  onOpenDoctor: (doctorKey: string) => void;
};

export function DoctorDirectoryScreen({ filter, onOpenDoctor }: Props) {
  const [doctors, setDoctors] = useState<DirectoryDoctor[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<DirectoryFilter>(filter);

  useEffect(() => {
    setActive(filter);
  }, [filter]);

  const load = () => {
    setStatus('loading');
    loadDoctorDirectory()
      .then((rows) => {
        setDoctors(rows);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  };

  useEffect(() => {
    load();
  }, []);

  const options = useMemo(() => {
    const specialties = unique(doctors.map((doctor) => doctor.specialty));
    const focuses = unique(doctors.map((doctor) => doctor.focus));
    const states = unique(doctors.map((doctor) => doctor.state));
    const practices = unique(doctors.map((doctor) => doctor.practiceType));
    const languages = unique(doctors.flatMap((doctor) => doctor.languages));
    return { specialties, focuses, states, practices, languages };
  }, [doctors]);

  const results = useMemo(() => filterDirectory(doctors, query, active), [doctors, query, active]);

  return (
    <View style={styles.root}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search by name"
        placeholderTextColor={colors.searchPlaceholder}
        style={styles.search}
      />
      <View style={styles.filterGroups}>
        <FilterRow
          label="Accepting"
          options={[{ id: 'yes', label: 'Accepting consults' }]}
          selected={active.acceptingOnly ? 'yes' : undefined}
          onSelect={() => setActive((current) => ({ ...current, acceptingOnly: !current.acceptingOnly }))}
        />
        <FilterRow label="Specialty" options={options.specialties.map(option)} selected={active.specialty} onSelect={(value) => setActive((current) => ({ ...current, specialty: current.specialty === value ? undefined : value }))} />
        <FilterRow label="Focus" options={options.focuses.map(option)} selected={active.focus} onSelect={(value) => setActive((current) => ({ ...current, focus: current.focus === value ? undefined : value }))} />
        <FilterRow label="State" options={options.states.map(option)} selected={active.state} onSelect={(value) => setActive((current) => ({ ...current, state: current.state === value ? undefined : value }))} />
        <FilterRow label="Language" options={options.languages.map(option)} selected={active.language} onSelect={(value) => setActive((current) => ({ ...current, language: current.language === value ? undefined : value }))} />
        <FilterRow label="Practice" options={options.practices.map(option)} selected={active.practiceType} onSelect={(value) => setActive((current) => ({ ...current, practiceType: current.practiceType === value ? undefined : value }))} />
      </View>
      {status === 'loading' ? <ActivityIndicator color={colors.navy} style={styles.pad} /> : null}
      {status === 'error' ? (
        <View style={styles.pad}>
          <Text style={styles.empty}>Could not load doctors.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Retry loading doctors" onPress={load} style={styles.clear}>
            <Text style={styles.clearText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      {status === 'ready' ? (
        <ScrollView contentContainerStyle={styles.list}>
          {results.map((doctor) => {
            const theme = themeForSpecialty(doctor.specialty);
            return (
              <Pressable
                key={doctor.doctorKey}
                accessibilityRole="button"
                accessibilityLabel={`Open profile for ${doctor.displayName}`}
                onPress={() => onOpenDoctor(doctor.doctorKey)}
                style={({ pressed }) => [styles.card, pressed && styles.pressed]}
              >
                <Avatar initials={doctor.initials} color={theme.accent} gradient={theme.gradient} size={40} />
                <View style={styles.meta}>
                  <Text style={styles.name}>{doctor.displayName}</Text>
                  <Text style={styles.line}>{doctor.specialtyTitle} · {doctor.state}</Text>
                  <Text style={styles.line}>{doctor.languages.join(', ')}</Text>
                </View>
              </Pressable>
            );
          })}
          {results.length === 0 ? (
            <View style={styles.pad}>
              <Text style={styles.empty}>{profileCopy.emptyDirectory}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={profileCopy.clearFilters}
                onPress={() => {
                  setQuery('');
                  setActive({});
                }}
                style={styles.clear}
              >
                <Text style={styles.clearText}>{profileCopy.clearFilters}</Text>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      ) : null}
    </View>
  );
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function option(value: string): { id: string; label: string } {
  return { id: value, label: value };
}

function FilterRow({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: { id: string; label: string }[];
  selected?: string;
  onSelect: (id: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <View style={styles.filterRow}>
      <Text style={styles.filterLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        {options.map((item) => (
          <FilterChip
            key={item.id}
            label={item.label}
            selected={selected === item.id}
            onPress={() => onSelect(item.id)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function FilterChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.filterChip, selected && styles.filterChipOn]}
    >
      <Text style={[styles.filterText, !selected && styles.filterTextIdle]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center' },
  search: {
    marginHorizontal: space.lg,
    marginTop: space.sm,
    backgroundColor: colors.inputBg,
    borderRadius: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    color: colors.textPrimary,
  },
  filterGroups: { maxHeight: 168 },
  filterRow: { flexDirection: 'row', alignItems: 'center' },
  filterLabel: { width: 72, marginLeft: space.lg, color: colors.navy, fontSize: 11, fontWeight: '700' },
  filters: { paddingRight: space.lg, paddingVertical: space.xs, gap: space.sm },
  filterChip: { borderRadius: 999, borderWidth: 1, borderColor: 'rgba(10,14,39,0.28)', paddingHorizontal: space.sm, paddingVertical: space.xs },
  filterChipOn: { backgroundColor: colors.white },
  filterText: { color: colors.navy, fontSize: 12, fontWeight: '700' },
  filterTextIdle: { color: colors.navy },
  list: { paddingHorizontal: space.lg, paddingBottom: space.xl, gap: space.md },
  card: { flexDirection: 'row', gap: space.md, backgroundColor: colors.cardBg, borderRadius: space.md, padding: space.md, alignItems: 'center' },
  meta: { flex: 1 },
  name: { color: colors.textPrimary, fontWeight: '800' },
  line: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  empty: { color: colors.navy, fontSize: 16, fontWeight: '700' },
  clear: { marginTop: space.sm, alignSelf: 'flex-start', backgroundColor: colors.white, borderRadius: 999, paddingHorizontal: space.md, paddingVertical: space.sm },
  clearText: { color: colors.navy, fontWeight: '800' },
  pad: { padding: space.lg },
  pressed: { opacity: 0.72 },
});
