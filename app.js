(() => {
  "use strict";

  const STORAGE_KEY = "scrutiny_sanvi_neet_unit_test_3_v1";
  const EXAM_DURATION_MS = 3 * 60 * 60 * 1000;
  const MAX_SCORE = 720;
  const SECTION_SIZE = 45;
  const SECTION_META = {
    Physics: { color: "#2965bb", soft: "#eaf2ff", icon: "⚙" },
    Chemistry: { color: "#8b48ba", soft: "#f4eaff", icon: "⚗" },
    Botany: { color: "#2b8a55", soft: "#e8f7ed", icon: "❧" },
    Zoology: { color: "#d07124", soft: "#fff0df", icon: "🐸" }
  };

  const questions = [
    ...(window.PHYSICS_QUESTIONS || []),
    ...(window.CHEMISTRY_QUESTIONS || []),
    ...(window.BOTANY_QUESTIONS || []),
    ...(window.ZOOLOGY_QUESTIONS || [])
  ];
  const sections = Object.keys(SECTION_META);
  let state = loadState();
  let timerHandle = null;
  let toastHandle = null;
  let currentReviewFilter = "incorrect";
  let confettiStarted = false;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!parsed || parsed.version !== 1) return null;
      parsed.answers = parsed.answers || {};
      parsed.marked = parsed.marked || {};
      return parsed;
    } catch {
      return null;
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      showToast("Progress could not be saved. Keep this page open.");
    }
  }

  function showToast(message) {
    const toast = $("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastHandle);
    toastHandle = setTimeout(() => toast.classList.remove("show"), 1800);
  }

  function showScreen(screenId) {
    ["welcomeScreen", "examScreen", "resultScreen"].forEach((id) => {
      $("#" + id).classList.toggle("hidden", id !== screenId);
    });
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function openModal(id) {
    $("#" + id).classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function closeModal(modal) {
    const element = typeof modal === "string" ? $("#" + modal) : modal;
    if (element) element.classList.add("hidden");
    document.body.style.overflow = "";
  }

  function validateQuestionBank() {
    const ids = new Set(questions.map((item) => item.id));
    const valid = questions.length === 180 &&
      ids.size === 180 &&
      sections.every((section) => questions.filter((item) => item.section === section).length === 45) &&
      questions.every((item) => item.options.length === 4 && Number.isInteger(item.answer) && item.answer >= 0 && item.answer <= 3);
    if (!valid) {
      document.body.innerHTML = "<div class='noscript'><strong>Question bank validation failed.</strong> Please contact Scrutiny Academy before starting the test.</div>";
      throw new Error("Invalid question bank");
    }
  }

  function initialise() {
    validateQuestionBank();
    bindEvents();
    buildSectionTabs();

    if (state && state.submittedAt) {
      showResults();
      return;
    }

    if (state && state.startedAt) {
      if (Date.now() >= state.deadline) {
        submitExam(true);
      } else {
        launchExamInterface(true);
      }
      return;
    }

    showScreen("welcomeScreen");
  }

  function bindEvents() {
    $("#attemptConsent").addEventListener("change", (event) => {
      $("#startExamBtn").disabled = !event.target.checked;
    });
    $("#startExamBtn").addEventListener("click", () => openModal("startModal"));
    $("#confirmStartBtn").addEventListener("click", startFreshAttempt);

    $$("[data-close-modal]").forEach((button) => {
      button.addEventListener("click", () => closeModal(button.closest(".modal-backdrop")));
    });
    $$(".modal-backdrop").forEach((backdrop) => {
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) closeModal(backdrop);
      });
    });

    $("#prevBtn").addEventListener("click", () => navigateTo(state.currentIndex - 1));
    $("#nextBtn").addEventListener("click", () => {
      if (state.currentIndex < questions.length - 1) navigateTo(state.currentIndex + 1);
      else openSubmitDialog();
    });
    $("#reviewBtn").addEventListener("click", toggleReview);
    $("#clearBtn").addEventListener("click", clearResponse);
    $$("[data-open-submit]").forEach((button) => button.addEventListener("click", openSubmitDialog));
    $("#confirmSubmitBtn").addEventListener("click", () => submitExam(false));

    $("#nativeShareBtn").addEventListener("click", shareResult);
    $("#printBtn").addEventListener("click", () => window.print());
    $("#downloadIncorrectBtn").addEventListener("click", downloadIncorrectQuestions);

    $("#reviewFilters").addEventListener("click", (event) => {
      const button = event.target.closest("[data-filter]");
      if (!button) return;
      currentReviewFilter = button.dataset.filter;
      $$("#reviewFilters button").forEach((item) => item.classList.toggle("active", item === button));
      renderReviewList(currentReviewFilter);
    });

    document.addEventListener("keydown", handleKeyboard);
    window.addEventListener("beforeunload", (event) => {
      if (state && state.startedAt && !state.submittedAt) {
        saveState();
        event.preventDefault();
        event.returnValue = "";
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && state && !state.submittedAt) saveState();
    });
  }

  function startFreshAttempt() {
    const now = Date.now();
    state = {
      version: 1,
      candidate: "Sanvi Mantri",
      startedAt: now,
      deadline: now + EXAM_DURATION_MS,
      submittedAt: null,
      currentIndex: 0,
      answers: {},
      marked: {},
      result: null
    };
    saveState();
    closeModal("startModal");
    launchExamInterface(false);
  }

  function launchExamInterface(resumed) {
    showScreen("examScreen");
    state.currentIndex = Math.max(0, Math.min(questions.length - 1, Number(state.currentIndex) || 0));
    renderQuestion();
    updateSidebar();
    startTimer();
    if (resumed) showToast("Active attempt resumed. Your timer continued.");
  }

  function buildSectionTabs() {
    const host = $("#sectionTabs");
    host.innerHTML = sections.map((section, index) =>
      `<button class="section-tab" data-section-index="${index}" role="tab">
        ${SECTION_META[section].icon} ${section}<span>45 questions</span>
      </button>`
    ).join("");
    host.addEventListener("click", (event) => {
      const button = event.target.closest("[data-section-index]");
      if (!button || !state || state.submittedAt) return;
      navigateTo(Number(button.dataset.sectionIndex) * SECTION_SIZE);
    });
  }

  function renderQuestion() {
    const question = questions[state.currentIndex];
    const selected = state.answers[question.id];
    const meta = SECTION_META[question.section];

    $("#subjectBadge").textContent = question.section;
    $("#subjectBadge").style.background = meta.soft;
    $("#subjectBadge").style.color = meta.color;
    $("#questionCounter").textContent = `Question ${state.currentIndex + 1} of ${questions.length}`;
    $("#questionNumber").textContent = String(state.currentIndex + 1).padStart(2, "0");
    $("#topicLabel").textContent = question.topic;
    $("#difficultyLabel").textContent = question.difficulty;
    $("#questionText").innerHTML = question.question;
    $("#optionsList").innerHTML = question.options.map((option, index) => {
      const isSelected = selected === index;
      return `<label class="option${isSelected ? " selected" : ""}">
        <input type="radio" name="answer" value="${index}" ${isSelected ? "checked" : ""}>
        <span class="option-letter">${String.fromCharCode(65 + index)}</span>
        <span class="option-text">${escapeHTML(option)}</span>
      </label>`;
    }).join("");

    $$("#optionsList .option").forEach((label) => {
      label.addEventListener("click", () => selectAnswer(Number(label.querySelector("input").value)));
    });

    const marked = Boolean(state.marked[question.id]);
    $("#reviewBtn").classList.toggle("active", marked);
    $("#reviewBtn").innerHTML = marked ? "★ Marked for review" : "☆ Mark for review";
    $("#prevBtn").disabled = state.currentIndex === 0;
    $("#nextBtn").textContent = state.currentIndex === questions.length - 1 ? "Review & submit →" : "Save & next →";
    updateSidebar();
  }

  function selectAnswer(optionIndex) {
    const question = questions[state.currentIndex];
    state.answers[question.id] = optionIndex;
    saveState();
    renderQuestion();
    const indicator = $("#savedIndicator");
    indicator.classList.add("show");
    setTimeout(() => indicator.classList.remove("show"), 1000);
  }

  function clearResponse() {
    const question = questions[state.currentIndex];
    if (state.answers[question.id] === undefined) {
      showToast("No response selected for this question.");
      return;
    }
    delete state.answers[question.id];
    saveState();
    renderQuestion();
    showToast("Response cleared.");
  }

  function toggleReview() {
    const question = questions[state.currentIndex];
    if (state.marked[question.id]) delete state.marked[question.id];
    else state.marked[question.id] = true;
    saveState();
    renderQuestion();
    showToast(state.marked[question.id] ? "Marked for review." : "Removed from review.");
  }

  function navigateTo(index) {
    if (index < 0 || index >= questions.length) return;
    state.currentIndex = index;
    saveState();
    renderQuestion();
    $(".question-column").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function updateSidebar() {
    if (!state) return;
    const answered = Object.keys(state.answers).filter((id) => state.answers[id] !== undefined).length;
    const marked = Object.keys(state.marked).filter((id) => state.marked[id]).length;
    const unanswered = questions.length - answered;
    const percent = Math.round((answered / questions.length) * 100);
    $("#answeredCount").textContent = answered;
    $("#reviewCount").textContent = marked;
    $("#unansweredCount").textContent = unanswered;
    $("#progressPercent").textContent = percent + "%";
    $("#answerProgress").style.width = percent + "%";

    const activeSectionIndex = Math.floor(state.currentIndex / SECTION_SIZE);
    $$(".section-tab").forEach((button, index) => {
      button.classList.toggle("active", index === activeSectionIndex);
      const section = sections[index];
      const sectionAnswered = questions.filter((q) => q.section === section && state.answers[q.id] !== undefined).length;
      button.querySelector("span").textContent = `${sectionAnswered}/45 answered`;
    });
    renderPalette(activeSectionIndex);
  }

  function renderPalette(sectionIndex) {
    const start = sectionIndex * SECTION_SIZE;
    const currentSectionQuestions = questions.slice(start, start + SECTION_SIZE);
    $("#paletteRange").textContent = `${start + 1}–${start + SECTION_SIZE}`;
    $("#questionPalette").innerHTML = currentSectionQuestions.map((question, localIndex) => {
      const globalIndex = start + localIndex;
      const classes = ["palette-btn"];
      if (state.answers[question.id] !== undefined) classes.push("answered");
      if (state.marked[question.id]) classes.push("review");
      if (globalIndex === state.currentIndex) classes.push("current");
      const label = `Question ${globalIndex + 1}${state.answers[question.id] !== undefined ? ", answered" : ", unanswered"}${state.marked[question.id] ? ", marked for review" : ""}`;
      return `<button class="${classes.join(" ")}" data-index="${globalIndex}" aria-label="${label}">${localIndex + 1}</button>`;
    }).join("");
    $$("#questionPalette [data-index]").forEach((button) => {
      button.addEventListener("click", () => navigateTo(Number(button.dataset.index)));
    });
  }

  function startTimer() {
    clearInterval(timerHandle);
    updateTimer();
    timerHandle = setInterval(updateTimer, 1000);
  }

  function updateTimer() {
    if (!state || state.submittedAt) {
      clearInterval(timerHandle);
      return;
    }
    const remaining = Math.max(0, state.deadline - Date.now());
    const formatted = formatClock(remaining);
    $("#desktopTimer").textContent = formatted;
    $("#mobileTimer").textContent = formatted;
    const ratio = Math.max(0, Math.min(1, remaining / EXAM_DURATION_MS));
    $("#timerProgress").style.width = ratio * 100 + "%";
    $(".timer-card").classList.toggle("warning", remaining <= 15 * 60 * 1000);
    if (remaining <= 0) submitExam(true);
  }

  function formatClock(milliseconds) {
    const totalSeconds = Math.ceil(milliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
  }

  function openSubmitDialog() {
    const answered = Object.keys(state.answers).length;
    const marked = Object.keys(state.marked).length;
    $("#modalAnswered").textContent = answered;
    $("#modalUnanswered").textContent = questions.length - answered;
    $("#modalMarked").textContent = marked;
    $("#submitSummary").textContent = answered === questions.length
      ? "You have responded to all 180 questions. You may submit now."
      : `You still have ${questions.length - answered} unanswered question${questions.length - answered === 1 ? "" : "s"}.`;
    openModal("submitModal");
  }

  function calculateResult() {
    let correct = 0;
    let incorrect = 0;
    let unattempted = 0;
    const sectionBreakdown = {};

    sections.forEach((section) => {
      sectionBreakdown[section] = { correct: 0, incorrect: 0, unattempted: 0, score: 0, accuracy: 0 };
    });

    questions.forEach((question) => {
      const response = state.answers[question.id];
      const bucket = sectionBreakdown[question.section];
      if (response === undefined) {
        unattempted++;
        bucket.unattempted++;
      } else if (response === question.answer) {
        correct++;
        bucket.correct++;
      } else {
        incorrect++;
        bucket.incorrect++;
      }
    });

    Object.values(sectionBreakdown).forEach((bucket) => {
      bucket.score = bucket.correct * 4 - bucket.incorrect;
      const attempts = bucket.correct + bucket.incorrect;
      bucket.accuracy = attempts ? Math.round((bucket.correct / attempts) * 1000) / 10 : 0;
    });

    const attempts = correct + incorrect;
    return {
      score: correct * 4 - incorrect,
      correct,
      incorrect,
      unattempted,
      accuracy: attempts ? Math.round((correct / attempts) * 1000) / 10 : 0,
      timeUsed: Math.min(EXAM_DURATION_MS, Math.max(0, (state.submittedAt || Date.now()) - state.startedAt)),
      sectionBreakdown
    };
  }

  function submitExam(autoSubmitted) {
    if (!state || state.submittedAt) return;
    state.submittedAt = Date.now();
    state.autoSubmitted = Boolean(autoSubmitted);
    state.result = calculateResult();
    saveState();
    clearInterval(timerHandle);
    closeModal("submitModal");
    showResults();
    showToast(autoSubmitted ? "Time is over. Your test was submitted." : "Examination submitted successfully.");
  }

  function getPerformance(score) {
    if (score >= 700) return {
      label: "Outstanding",
      headline: "Extraordinary work, Sanvi!",
      story: "This is an exceptional score. Your accuracy, composure and preparation are already speaking the language of a future doctor. Protect this level with careful revision—especially of the few questions that still challenged you."
    };
    if (score >= 600) return {
      label: "Excellent",
      headline: "Excellent performance, Sanvi!",
      story: "You have built a powerful NEET foundation. This score shows strong concept control and exam temperament. Review every miss with curiosity, refine the small gaps, and keep moving toward that white coat."
    };
    if (score >= 500) return {
      label: "Very good",
      headline: "Very good work, Sanvi!",
      story: "You are moving in the right direction with real momentum. Your preparation is producing results; now convert each mistake into a short revision target and your next score can climb sharply."
    };
    if (score >= 400) return {
      label: "Good",
      headline: "Good progress, Sanvi!",
      story: "This is a meaningful step forward. You already have a workable base; focused correction of weak topics and better question selection can turn this good performance into a very good one."
    };
    if (score >= 300) return {
      label: "Promising",
      headline: "Your foundation is taking shape!",
      story: "There is clear promise in this attempt. Treat the analysis below as your personal map: revise the weakest section first, practise its missed concepts, and return stronger in the next test."
    };
    if (score >= 150) return {
      label: "Keep building",
      headline: "Every correct answer is progress!",
      story: "This attempt has shown exactly where your marks are waiting. You do not need to fix everything at once—master the incorrect concepts in small groups, then practise them until they feel familiar."
    };
    return {
      label: "Brave beginning",
      headline: "Showing up is your first win, Sanvi!",
      story: "A baseline is not a verdict; it is the first page of your improvement story. Start with the explanations below, rebuild one topic at a time, and let consistency—not one score—define your journey."
    };
  }

  function showResults() {
    if (!state.result) {
      state.result = calculateResult();
      saveState();
    }
    showScreen("resultScreen");
    const result = state.result;
    const performance = getPerformance(result.score);

    $("#resultHeadline").textContent = performance.headline;
    $("#resultStory").textContent = performance.story;
    $("#performanceLabel").textContent = performance.label;
    $("#finalScore").textContent = result.score;
    $("#finalCorrect").textContent = result.correct;
    $("#finalIncorrect").textContent = result.incorrect;
    $("#finalUnattempted").textContent = result.unattempted;
    $("#finalAccuracy").textContent = formatPercent(result.accuracy);
    $("#finalTime").textContent = formatDuration(result.timeUsed);
    $("#boardScore").textContent = result.score;
    $("#boardStatus").textContent = performance.label;
    $("#completedDate").textContent = new Date(state.submittedAt).toLocaleString("en-IN", {
      dateStyle: "medium", timeStyle: "short"
    });
    $("#scoreGauge").style.setProperty("--score-angle", Math.max(0, Math.min(360, (result.score / MAX_SCORE) * 360)) + "deg");

    $("#correctFilterCount").textContent = result.correct;
    $("#incorrectFilterCount").textContent = result.incorrect;
    $("#unattemptedFilterCount").textContent = result.unattempted;
    $("#markedFilterCount").textContent = Object.keys(state.marked).length;

    renderSectionAnalysis(result);
    renderReviewList(currentReviewFilter);
    configureShareLinks(result, performance);
    setTimeout(launchConfetti, 250);
  }

  function renderSectionAnalysis(result) {
    $("#sectionAnalysisBody").innerHTML = sections.map((section) => {
      const data = result.sectionBreakdown[section];
      const meta = SECTION_META[section];
      return `<tr>
        <td><span class="subject-cell"><i class="subject-swatch" style="background:${meta.color}"></i>${section}</span></td>
        <td><strong>${data.score}/180</strong></td>
        <td>${data.correct}</td>
        <td>${data.incorrect}</td>
        <td>${data.unattempted}</td>
        <td>${formatPercent(data.accuracy)}</td>
      </tr>`;
    }).join("");
  }

  function getQuestionState(question) {
    const response = state.answers[question.id];
    if (response === undefined) return "unattempted";
    return response === question.answer ? "correct" : "incorrect";
  }

  function renderReviewList(filter) {
    const filtered = questions.filter((question) => {
      if (filter === "all") return true;
      if (filter === "marked") return Boolean(state.marked[question.id]);
      return getQuestionState(question) === filter;
    });

    if (!filtered.length) {
      const messages = {
        incorrect: ["🎯", "No incorrect answers", "Beautiful accuracy—there are no incorrect attempted questions to revise."],
        unattempted: ["✓", "Nothing left unanswered", "You responded to every question in the examination."],
        marked: ["☆", "No marked questions", "You did not leave any question marked for review."],
        correct: ["↗", "Keep practising", "Correct answers will appear here after an attempt."]
      };
      const message = messages[filter] || ["✓", "Nothing to display", "Try another analysis filter."];
      $("#reviewList").innerHTML = `<div class="empty-review"><span>${message[0]}</span><h3>${message[1]}</h3><p>${message[2]}</p></div>`;
      return;
    }

    $("#reviewList").innerHTML = filtered.map((question) => {
      const response = state.answers[question.id];
      const status = getQuestionState(question);
      const responseText = response === undefined ? "Not attempted" : `${letter(response)}. ${escapeHTML(question.options[response])}`;
      const correctText = `${letter(question.answer)}. ${escapeHTML(question.options[question.answer])}`;
      return `<article class="review-card ${status}">
        <div class="review-card-head">
          <div><span class="review-id">${question.id}</span><span class="review-subject">${question.section} • ${escapeHTML(question.topic)}</span><span class="review-state">${status}</span></div>
          ${state.marked[question.id] ? '<span class="review-star">★ Marked</span>' : ""}
        </div>
        <div class="review-question">${question.question}</div>
        <div class="answer-comparison">
          <div class="answer-box ${status === "incorrect" ? "wrong-answer" : ""}"><span>Your answer</span>${responseText}</div>
          <div class="answer-box correct-answer"><span>Correct answer</span>${correctText}</div>
        </div>
        <div class="explanation"><strong>Why:</strong> ${escapeHTML(question.explanation)}</div>
      </article>`;
    }).join("");
  }

  function configureShareLinks(result, performance) {
    const message = [
      "Hello Scrutiny Academy,",
      "Sanvi Mantri has completed NEET 2028 Unit Test 3.",
      `Score: ${result.score}/720`,
      `Correct: ${result.correct} | Incorrect: ${result.incorrect} | Unattempted: ${result.unattempted}`,
      `Accuracy: ${formatPercent(result.accuracy)} | Performance: ${performance.label}`,
      "One step closer to the white coat! 🩺"
    ].join("\n");
    $("#whatsappShare").href = "https://wa.me/919052389200?text=" + encodeURIComponent(message);
    $("#nativeShareBtn").dataset.shareText = message;
  }

  async function shareResult() {
    const text = $("#nativeShareBtn").dataset.shareText;
    const shareData = { title: "Sanvi's NEET Unit Test 3 Result", text, url: window.location.href };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (error) {
        if (error && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(text + "\n" + window.location.href);
      showToast("Score copied. You can paste and share it.");
    } catch {
      const area = document.createElement("textarea");
      area.value = text + "\n" + window.location.href;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
      showToast("Score copied. You can paste and share it.");
    }
  }

  function downloadIncorrectQuestions() {
    const incorrect = questions.filter((question) => getQuestionState(question) === "incorrect");
    if (!incorrect.length) {
      showToast("There are no incorrect attempted questions to download.");
      return;
    }
    const result = state.result;
    const cards = incorrect.map((question, index) => {
      const response = state.answers[question.id];
      return `<article>
        <div class="tag">${question.section} • ${escapeHTML(question.topic)} • ${question.difficulty}</div>
        <h2>${index + 1}. ${question.question}</h2>
        <p class="wrong"><b>Your answer:</b> ${letter(response)}. ${escapeHTML(question.options[response])}</p>
        <p class="right"><b>Correct answer:</b> ${letter(question.answer)}. ${escapeHTML(question.options[question.answer])}</p>
        <p class="why"><b>Explanation:</b> ${escapeHTML(question.explanation)}</p>
      </article>`;
    }).join("");
    const report = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Sanvi Unit Test 3 — Incorrect MCQs</title><style>
      body{font-family:Arial,sans-serif;color:#173b44;max-width:900px;margin:35px auto;padding:0 20px;line-height:1.55}header{border-bottom:4px solid #087f6b;padding-bottom:18px;margin-bottom:24px}h1{margin:0;color:#073b4c}.summary{color:#577078}article{border:1px solid #d5e4e3;border-left:5px solid #d84d5f;border-radius:12px;padding:18px;margin:14px 0;break-inside:avoid}.tag{color:#087f6b;font-weight:700;font-size:11px;text-transform:uppercase}h2{font-size:16px}.wrong,.right,.why{padding:10px;border-radius:8px;font-size:13px}.wrong{background:#fff0f2}.right{background:#dff8f1}.why{background:#f4f8f8}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #cadbda;padding:8px;text-align:center}svg{max-width:440px}@media print{body{margin:0}}
    </style></head><body><header><h1>Sanvi Mantri — Incorrect MCQ Revision List</h1><p class="summary">Scrutiny Academy • NEET 2028 Unit Test 3 • Score ${result.score}/720 • ${incorrect.length} incorrect attempted question${incorrect.length === 1 ? "" : "s"}</p></header>${cards}<footer><p><b>Scrutiny Academy Team:</b> Every corrected mistake brings you one step closer to your white coat. 🩺</p></footer></body></html>`;
    const blob = new Blob([report], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "Sanvi-Unit-Test-3-Incorrect-MCQs.html";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("Incorrect-question revision file downloaded.");
  }

  function handleKeyboard(event) {
    if (!state || state.submittedAt || $("#examScreen").classList.contains("hidden")) return;
    if (!$$(".modal-backdrop:not(.hidden)").length) {
      if (["1", "2", "3", "4"].includes(event.key)) selectAnswer(Number(event.key) - 1);
      else if (event.key === "ArrowLeft") navigateTo(state.currentIndex - 1);
      else if (event.key === "ArrowRight") navigateTo(state.currentIndex + 1);
      else if (event.key.toLowerCase() === "m") toggleReview();
    }
  }

  function launchConfetti() {
    if (confettiStarted || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    confettiStarted = true;
    const canvas = $("#confettiCanvas");
    const context = canvas.getContext("2d");
    const scale = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = window.innerWidth * scale;
      canvas.height = window.innerHeight * scale;
      context.setTransform(scale, 0, 0, scale, 0, 0);
    };
    resize();
    const colors = ["#16a085", "#53d4bb", "#f4bc31", "#d84d5f", "#4f7ed1", "#ffffff"];
    const pieces = Array.from({ length: 130 }, () => ({
      x: Math.random() * window.innerWidth,
      y: -20 - Math.random() * window.innerHeight * 0.45,
      size: 4 + Math.random() * 8,
      speed: 2 + Math.random() * 4,
      drift: -1.4 + Math.random() * 2.8,
      rotation: Math.random() * Math.PI,
      spin: -0.12 + Math.random() * 0.24,
      color: colors[Math.floor(Math.random() * colors.length)]
    }));
    const started = performance.now();
    function frame(now) {
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      pieces.forEach((piece) => {
        piece.y += piece.speed;
        piece.x += piece.drift;
        piece.rotation += piece.spin;
        context.save();
        context.translate(piece.x, piece.y);
        context.rotate(piece.rotation);
        context.fillStyle = piece.color;
        context.fillRect(-piece.size / 2, -piece.size / 3, piece.size, piece.size * 0.65);
        context.restore();
      });
      if (now - started < 4200) requestAnimationFrame(frame);
      else context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
    requestAnimationFrame(frame);
  }

  function letter(index) {
    return String.fromCharCode(65 + index);
  }

  function formatPercent(value) {
    return Number.isInteger(value) ? value + "%" : value.toFixed(1) + "%";
  }

  function formatDuration(milliseconds) {
    const totalMinutes = Math.max(0, Math.round(milliseconds / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (!hours) return minutes + "m";
    return hours + "h " + minutes + "m";
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[character]);
  }

  initialise();
})();
