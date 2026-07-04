import SwiftUI

struct RoutinesView: View {
    @State private var workoutTypes: [WorkoutType] = []
    @State private var selectedType: WorkoutType? = nil
    @State private var exercises: [ExerciseInfo] = []
    @State private var newExercise: String = ""
    @State private var newTargetSets: String = ""
    @State private var newTargetReps: String = ""
    @State private var isAdding = false

    // Sheet-driven edit (replaces inline Editar/Quitar buttons)
    @State private var editSheetExercise: ExerciseInfo? = nil
    @State private var editSets: String = ""
    @State private var editReps: String = ""

    @State private var customRoutines: [CustomRoutine] = []
    @State private var newRoutineName = ""
    @State private var newRoutineExercises = ""
    @State private var isCreating = false

    // Row height estimate for the List frame (name + optional target label + vertical insets)
    private let rowH: CGFloat = 56

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ForjaEyebrow(text: "Rutinas")
                    Text("Mis ejercicios")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundColor(.forjaChalk)

                    // ── Tipo de entreno picker ──────────────────────────────
                    ForjaCard {
                        Text("TIPO DE ENTRENO")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(.forjaChalk)
                        ForEach(workoutTypes) { type in
                            Button {
                                Task {
                                    selectedType = type
                                    exercises = (try? await APIClient.shared.getExercises(for: type.id)) ?? []
                                    newExercise = ""; newTargetSets = ""; newTargetReps = ""
                                }
                            } label: {
                                HStack {
                                    Text(type.label)
                                        .foregroundColor(selectedType?.id == type.id ? .forjaEmber : .forjaChalk)
                                        .font(.system(size: 15, weight: .semibold))
                                        .lineLimit(1)
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .foregroundColor(.forjaSteel)
                                        .font(.system(size: 12))
                                }
                                .padding(.vertical, 8)
                            }
                        }
                    }

                    // ── Ejercicios de la rutina seleccionada ───────────────
                    if let selected = selectedType {
                        // Header card (label + empty state)
                        VStack(spacing: 0) {
                            HStack {
                                Text(selected.label.uppercased())
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundColor(.forjaBrass)
                                Spacer()
                                Text("Tap para editar · Deslizá para eliminar")
                                    .font(.system(size: 9, design: .monospaced))
                                    .foregroundColor(.forjaSteel)
                            }
                            .padding(16)
                            .background(Color.forjaPanel)

                            if exercises.isEmpty {
                                Text("Sin ejercicios cargados.")
                                    .foregroundColor(.forjaSteel)
                                    .font(.system(size: 13))
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, 16)
                                    .padding(.bottom, 16)
                                    .background(Color.forjaPanel)
                            } else {
                                Divider().background(Color.forjaLine)

                                // ← List with swipeActions — this is the key change
                                List {
                                    ForEach(exercises) { exercise in
                                        exerciseRow(exercise)
                                            .listRowBackground(Color.forjaPanel)
                                            .listRowSeparatorTint(Color.forjaLine)
                                            .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                                Button(role: .destructive) {
                                                    Task { await removeExercise(exercise.exercise_name, from: selected) }
                                                } label: {
                                                    Label("Eliminar", systemImage: "trash")
                                                }
                                            }
                                            .onTapGesture {
                                                editSets = exercise.target_sets.map(String.init) ?? ""
                                                editReps = exercise.target_reps ?? ""
                                                editSheetExercise = exercise
                                            }
                                    }
                                }
                                .listStyle(.plain)
                                .scrollContentBackground(.hidden)
                                .scrollDisabled(true)
                                .frame(height: CGFloat(exercises.count) * rowH)
                            }
                        }
                        .background(Color.forjaPanel)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.forjaLine, lineWidth: 1))

                        // ── Agregar ejercicio ───────────────────────────────
                        ForjaCard {
                            Text("AGREGAR EJERCICIO")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundColor(.forjaChalk)
                            routineTextField(placeholder: "Nombre del ejercicio", text: $newExercise)
                            HStack(spacing: 8) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("SERIES").font(.system(size: 9, design: .monospaced)).foregroundColor(.forjaSteel)
                                    routineTextField(placeholder: "ej. 4", text: $newTargetSets)
                                }
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("REPS").font(.system(size: 9, design: .monospaced)).foregroundColor(.forjaSteel)
                                    routineTextField(placeholder: "ej. 8-10", text: $newTargetReps)
                                }
                            }
                            ForjaPrimaryButton(title: isAdding ? "Agregando…" : "Agregar ejercicio") {
                                Task { await addExercise(to: selected) }
                            }
                        }
                    }

                    // ── Rutinas propias ─────────────────────────────────────
                    ForjaEyebrow(text: "Mis rutinas propias")

                    ForjaCard {
                        if customRoutines.isEmpty {
                            Text("Todavía no creaste rutinas propias.")
                                .foregroundColor(.forjaSteel)
                                .font(.system(size: 13))
                        }
                        ForEach(customRoutines) { routine in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(routine.name)
                                        .foregroundColor(.forjaChalk)
                                        .font(.system(size: 14, weight: .semibold))
                                    Text("PROPIA")
                                        .font(.system(size: 8, design: .monospaced))
                                        .foregroundColor(.forjaEmber)
                                }
                                Spacer()
                                Button {
                                    Task { await deleteRoutine(routine) }
                                } label: {
                                    Text("Eliminar")
                                        .font(.system(size: 12, weight: .semibold))
                                        .foregroundColor(.forjaEmber)
                                }
                            }
                            .padding(.vertical, 6)
                        }
                    }

                    ForjaCard {
                        Text("NUEVA RUTINA PROPIA")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(.forjaChalk)
                        routineTextField(placeholder: "Nombre de la rutina", text: $newRoutineName)
                        routineTextField(placeholder: "Ejercicios separados por coma", text: $newRoutineExercises)
                        ForjaPrimaryButton(title: isCreating ? "Creando…" : "Crear rutina") {
                            Task { await createRoutine() }
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 20)
                .padding(.bottom, 48)
            }
            .background(Color.forjaBg.ignoresSafeArea())
            .task {
                async let typesTask = APIClient.shared.getWorkoutTypes()
                async let routinesTask = APIClient.shared.getCustomRoutines()
                workoutTypes = (try? await typesTask) ?? []
                customRoutines = (try? await routinesTask) ?? []
            }
            // Edit sheet — tap-to-edit
            .sheet(item: $editSheetExercise) { exercise in
                editSheet(for: exercise)
            }
        }
    }

    // MARK: - Exercise row (sin botones visibles)

    @ViewBuilder
    private func exerciseRow(_ exercise: ExerciseInfo) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(exercise.exercise_name)
                .foregroundColor(.forjaChalk)
                .font(.system(size: 14))
                .lineLimit(1)
                .truncationMode(.tail)
            if let label = targetLabel(exercise) {
                Text(label)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(.forjaBrass)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    // MARK: - Edit sheet

    @ViewBuilder
    private func editSheet(for exercise: ExerciseInfo) -> some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 20) {
                Text(exercise.exercise_name)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundColor(.forjaChalk)
                    .lineLimit(2)

                VStack(alignment: .leading, spacing: 6) {
                    Text("SERIES OBJETIVO")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundColor(.forjaSteel)
                    routineTextField(placeholder: "ej. 4", text: $editSets)
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text("REPS OBJETIVO")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundColor(.forjaSteel)
                    routineTextField(placeholder: "ej. 8-10", text: $editReps)
                }

                ForjaPrimaryButton(title: "Guardar") {
                    Task {
                        if let selected = selectedType {
                            await saveEdit(exerciseName: exercise.exercise_name, in: selected)
                        }
                        editSheetExercise = nil
                    }
                }

                Spacer()
            }
            .padding(24)
            .background(Color.forjaBg.ignoresSafeArea())
            .navigationTitle("Editar ejercicio")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color.forjaPanel, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { editSheetExercise = nil }
                        .foregroundColor(.forjaBrass)
                }
            }
        }
        .presentationDetents([.medium])
        .presentationBackground(Color.forjaBg)
    }

    // MARK: - Helpers

    private func targetLabel(_ ex: ExerciseInfo) -> String? {
        switch (ex.target_sets, ex.target_reps) {
        case let (s?, r?): return "\(s) × \(r)"
        case let (s?, nil): return "\(s) series"
        case let (nil, r?): return r
        case (nil, nil): return nil
        }
    }

    private func routineTextField(placeholder: String, text: Binding<String>) -> some View {
        TextField(placeholder, text: text)
            .foregroundColor(.forjaChalk)
            .padding(10)
            .background(Color.forjaPanel2)
            .cornerRadius(6)
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.forjaLine, lineWidth: 1))
    }

    // MARK: - Actions

    private func removeExercise(_ name: String, from type: WorkoutType) async {
        try? await APIClient.shared.removeExercise(name, from: type.id)
        exercises = (try? await APIClient.shared.getExercises(for: type.id)) ?? []
    }

    private func saveEdit(exerciseName: String, in type: WorkoutType) async {
        let sets = Int(editSets.trimmingCharacters(in: .whitespaces))
        let reps = editReps.trimmingCharacters(in: .whitespaces).isEmpty
            ? nil : editReps.trimmingCharacters(in: .whitespaces)
        try? await APIClient.shared.patchExercise(exerciseName, in: type.id, targetSets: sets, targetReps: reps)
        exercises = (try? await APIClient.shared.getExercises(for: type.id)) ?? []
    }

    private func addExercise(to type: WorkoutType) async {
        let name = newExercise.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty, !isAdding else { return }
        isAdding = true
        defer { isAdding = false }
        let sets = Int(newTargetSets.trimmingCharacters(in: .whitespaces))
        let reps = newTargetReps.trimmingCharacters(in: .whitespaces).isEmpty
            ? nil : newTargetReps.trimmingCharacters(in: .whitespaces)
        try? await APIClient.shared.addExercise(name, to: type.id, targetSets: sets, targetReps: reps)
        exercises = (try? await APIClient.shared.getExercises(for: type.id)) ?? []
        newExercise = ""; newTargetSets = ""; newTargetReps = ""
    }

    private func createRoutine() async {
        let name = newRoutineName.trimmingCharacters(in: .whitespaces)
        let exNames = newRoutineExercises
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        guard !name.isEmpty, !exNames.isEmpty, !isCreating else { return }
        isCreating = true
        defer { isCreating = false }
        _ = try? await APIClient.shared.createCustomRoutine(CreateRoutinePayload(name: name, exercises: exNames))
        customRoutines = (try? await APIClient.shared.getCustomRoutines()) ?? []
        newRoutineName = ""; newRoutineExercises = ""
    }

    private func deleteRoutine(_ routine: CustomRoutine) async {
        try? await APIClient.shared.deleteCustomRoutine(routine.id)
        customRoutines = (try? await APIClient.shared.getCustomRoutines()) ?? []
    }
}
