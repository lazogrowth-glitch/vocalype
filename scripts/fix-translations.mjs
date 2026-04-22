import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const translations = {
  ar: {
    generic: "حدث خطأ ما. يرجى المحاولة مجددًا بعد لحظة.",
    network: "تعذّر الاتصال. تحقق من اتصالك بالإنترنت ثم حاول مجددًا.",
    accessRequired: "يجب التحقق من وصولك. سجّل الدخول مجددًا أو افتح اشتراكك.",
    microphone: "لا يمكن لـ Vocalype استخدام الميكروفون. تحقق من الإذن والميكروفون المحدد.",
    model: "تعذّر تحضير نموذج الصوت. تحقق من اتصالك وحاول مجددًا.",
    agent: "لم يتمكن المساعد من الرد. يرجى المحاولة مجددًا بعد لحظة.",
  },
  cs: {
    generic: "Něco se pokazilo. Zkuste to znovu za chvíli.",
    network: "Nelze se připojit. Zkontrolujte připojení k internetu a zkuste to znovu.",
    accessRequired: "Váš přístup musí být ověřen. Přihlaste se znovu nebo otevřete své předplatné.",
    microphone: "Vocalype nemůže použít mikrofon. Zkontrolujte oprávnění a vybraný mikrofon.",
    model: "Hlasový model nemohl být připraven. Zkontrolujte připojení a zkuste to znovu.",
    agent: "Asistent nemohl odpovědět. Zkuste to znovu za chvíli.",
  },
  de: {
    generic: "Etwas ist schiefgelaufen. Bitte versuche es in einem Moment erneut.",
    network: "Verbindung nicht möglich. Überprüfe deine Internetverbindung und versuche es erneut.",
    accessRequired: "Dein Zugang muss überprüft werden. Melde dich erneut an oder öffne dein Abonnement.",
    microphone: "Vocalype kann das Mikrofon nicht verwenden. Überprüfe die Berechtigung und das ausgewählte Mikrofon.",
    model: "Das Sprachmodell konnte nicht vorbereitet werden. Überprüfe deine Verbindung und versuche es erneut.",
    agent: "Der Assistent konnte nicht antworten. Bitte versuche es in einem Moment erneut.",
  },
  es: {
    generic: "Algo salió mal. Por favor, inténtalo de nuevo en un momento.",
    network: "No se puede conectar. Comprueba tu conexión a internet e inténtalo de nuevo.",
    accessRequired: "Tu acceso debe ser verificado. Inicia sesión de nuevo o abre tu suscripción.",
    microphone: "Vocalype no puede usar el micrófono. Comprueba el permiso y el micrófono seleccionado.",
    model: "El modelo de voz no pudo prepararse. Comprueba tu conexión e inténtalo de nuevo.",
    agent: "El asistente no pudo responder. Por favor, inténtalo de nuevo en un momento.",
  },
  it: {
    generic: "Qualcosa è andato storto. Riprova tra un momento.",
    network: "Impossibile connettersi. Controlla la connessione internet e riprova.",
    accessRequired: "Il tuo accesso deve essere verificato. Accedi di nuovo o apri il tuo abbonamento.",
    microphone: "Vocalype non può usare il microfono. Controlla il permesso e il microfono selezionato.",
    model: "Il modello vocale non ha potuto essere preparato. Controlla la connessione e riprova.",
    agent: "L'assistente non ha potuto rispondere. Riprova tra un momento.",
  },
  ja: {
    generic: "問題が発生しました。しばらくしてからもう一度お試しください。",
    network: "接続できません。インターネット接続を確認してからもう一度お試しください。",
    accessRequired: "アクセスの確認が必要です。再度サインインするか、サブスクリプションを開いてください。",
    microphone: "Vocalypeはマイクを使用できません。権限と選択したマイクを確認してください。",
    model: "音声モデルを準備できませんでした。接続を確認してからもう一度お試しください。",
    agent: "アシスタントが応答できませんでした。しばらくしてからもう一度お試しください。",
  },
  ko: {
    generic: "문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
    network: "연결할 수 없습니다. 인터넷 연결을 확인하고 다시 시도하세요.",
    accessRequired: "액세스를 확인해야 합니다. 다시 로그인하거나 구독을 열어보세요.",
    microphone: "Vocalype가 마이크를 사용할 수 없습니다. 권한과 선택된 마이크를 확인하세요.",
    model: "음성 모델을 준비할 수 없습니다. 연결을 확인하고 다시 시도하세요.",
    agent: "어시스턴트가 응답하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  },
  pl: {
    generic: "Coś poszło nie tak. Spróbuj ponownie za chwilę.",
    network: "Nie można się połączyć. Sprawdź połączenie internetowe i spróbuj ponownie.",
    accessRequired: "Twój dostęp musi zostać zweryfikowany. Zaloguj się ponownie lub otwórz subskrypcję.",
    microphone: "Vocalype nie może używać mikrofonu. Sprawdź uprawnienia i wybrany mikrofon.",
    model: "Model głosowy nie mógł zostać przygotowany. Sprawdź połączenie i spróbuj ponownie.",
    agent: "Asystent nie mógł odpowiedzieć. Spróbuj ponownie za chwilę.",
  },
  pt: {
    generic: "Algo correu mal. Por favor, tente novamente em breve.",
    network: "Não foi possível conectar. Verifique a sua ligação à internet e tente novamente.",
    accessRequired: "O seu acesso precisa de ser verificado. Inicie sessão novamente ou abra a sua subscrição.",
    microphone: "O Vocalype não consegue usar o microfone. Verifique a permissão e o microfone selecionado.",
    model: "O modelo de voz não pôde ser preparado. Verifique a sua ligação e tente novamente.",
    agent: "O assistente não conseguiu responder. Por favor, tente novamente em breve.",
  },
  ru: {
    generic: "Что-то пошло не так. Попробуйте ещё раз через мгновение.",
    network: "Не удаётся подключиться. Проверьте интернет-соединение и попробуйте снова.",
    accessRequired: "Ваш доступ требует подтверждения. Войдите снова или откройте подписку.",
    microphone: "Vocalype не может использовать микрофон. Проверьте разрешение и выбранный микрофон.",
    model: "Голосовую модель не удалось подготовить. Проверьте соединение и попробуйте снова.",
    agent: "Ассистент не смог ответить. Попробуйте ещё раз через мгновение.",
  },
  tr: {
    generic: "Bir şeyler ters gitti. Lütfen bir süre sonra tekrar deneyin.",
    network: "Bağlanılamıyor. İnternet bağlantınızı kontrol edin ve tekrar deneyin.",
    accessRequired: "Erişiminizin doğrulanması gerekiyor. Tekrar giriş yapın veya aboneliğinizi açın.",
    microphone: "Vocalype mikrofonu kullanamıyor. İzni ve seçili mikrofonu kontrol edin.",
    model: "Ses modeli hazırlanamadı. Bağlantınızı kontrol edin ve tekrar deneyin.",
    agent: "Asistan yanıt veremedi. Lütfen bir süre sonra tekrar deneyin.",
  },
  uk: {
    generic: "Щось пішло не так. Будь ласка, спробуйте ще раз за мить.",
    network: "Не вдається підключитися. Перевірте інтернет-з'єднання і спробуйте знову.",
    accessRequired: "Ваш доступ потрібно підтвердити. Увійдіть знову або відкрийте підписку.",
    microphone: "Vocalype не може використовувати мікрофон. Перевірте дозвіл і вибраний мікрофон.",
    model: "Голосову модель не вдалося підготувати. Перевірте з'єднання і спробуйте знову.",
    agent: "Асистент не зміг відповісти. Будь ласка, спробуйте ще раз за мить.",
  },
  vi: {
    generic: "Đã xảy ra sự cố. Vui lòng thử lại sau một lúc.",
    network: "Không thể kết nối. Kiểm tra kết nối internet của bạn rồi thử lại.",
    accessRequired: "Quyền truy cập của bạn cần được xác minh. Đăng nhập lại hoặc mở gói đăng ký.",
    microphone: "Vocalype không thể sử dụng micrô. Kiểm tra quyền và micrô đã chọn.",
    model: "Mô hình giọng nói không thể được chuẩn bị. Kiểm tra kết nối của bạn rồi thử lại.",
    agent: "Trợ lý không thể phản hồi. Vui lòng thử lại sau một lúc.",
  },
  zh: {
    generic: "出现了问题，请稍后重试。",
    network: "无法连接。请检查您的网络连接后重试。",
    accessRequired: "需要验证您的访问权限。请重新登录或打开您的订阅。",
    microphone: "Vocalype 无法使用麦克风。请检查权限和所选麦克风。",
    model: "无法准备语音模型。请检查您的连接后重试。",
    agent: "助手无法响应。请稍后重试。",
  },
  "zh-TW": {
    generic: "發生了問題，請稍後重試。",
    network: "無法連線。請檢查您的網路連線後重試。",
    accessRequired: "需要驗證您的存取權限。請重新登入或開啟您的訂閱。",
    microphone: "Vocalype 無法使用麥克風。請檢查權限和所選麥克風。",
    model: "無法準備語音模型。請檢查您的連線後重試。",
    agent: "助理無法回應。請稍後重試。",
  },
};

const localesDir = "src/i18n/locales";

for (const [lang, userFacing] of Object.entries(translations)) {
  const filePath = join(localesDir, lang, "translation.json");
  const raw = readFileSync(filePath, "utf8");
  const json = JSON.parse(raw);

  if (!json.errors) {
    console.log(`${lang}: no errors key, skipping`);
    continue;
  }
  if (json.errors.userFacing) {
    console.log(`${lang}: already has userFacing, skipping`);
    continue;
  }

  json.errors = { userFacing, ...json.errors };
  writeFileSync(filePath, JSON.stringify(json, null, 2) + "\n", "utf8");
  console.log(`${lang}: ✓`);
}
