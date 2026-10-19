import type { Language } from './language';

/**
 * Every message the API can say, in each language.
 *
 * Services throw plain English (`new ConflictException('...')`); the global
 * exception filter and the response interceptor look the text up here and swap
 * in the caller's language. English is the source text and the fallback: a
 * message with no entry is returned unchanged rather than failing, so a
 * forgotten translation degrades to English instead of breaking a response.
 * messages.coverage.spec.ts scans the source and fails the build when a new
 * message is added without an entry (or without being listed as exempt), so that
 * does not happen quietly.
 *
 * A `{name}` in the English text is a placeholder: the part of the message it
 * stands for is carried into the translation. `{label}` is special - the
 * captured text is looked up in LABELS so field names read naturally too.
 *
 * Sinhala and Tamil are machine-drafted and want a native speaker's review.
 */
type Triple = readonly [en: string, si: string, ta: string];

/** Field names as they appear in validation messages. */
const LABELS: Record<string, { si: string; ta: string }> = {
  'Full name': { si: 'සම්පූර්ණ නම', ta: 'முழுப் பெயர்' },
  'Permanent address': { si: 'ස්ථිර ලිපිනය', ta: 'நிரந்தர முகவரி' },
  NIC: { si: 'ජාතික හැඳුනුම්පත් අංකය', ta: 'தேசிய அடையாள அட்டை எண்' },
  'Passport number': { si: 'ගමන් බලපත්‍ර අංකය', ta: 'கடவுச்சீட்டு எண்' },
  'Primary phone': { si: 'ප්‍රධාන දුරකථන අංකය', ta: 'முதன்மைத் தொலைபேசி எண்' },
  'Secondary phone': { si: 'දෙවන දුරකථන අංකය', ta: 'இரண்டாம் தொலைபேசி எண்' },
  Phone: { si: 'දුරකථන අංකය', ta: 'தொலைபேசி எண்' },
  'Phone number': { si: 'දුරකථන අංකය', ta: 'தொலைபேசி எண்' },
  'WhatsApp number': { si: 'WhatsApp අංකය', ta: 'WhatsApp எண்' },
  'Emergency contact name': { si: 'හදිසි සම්බන්ධතා නම', ta: 'அவசரத் தொடர்பு பெயர்' },
  'Emergency contact number': { si: 'හදිසි සම්බන්ධතා අංකය', ta: 'அவசரத் தொடர்பு எண்' },
  Relationship: { si: 'සම්බන්ධතාව', ta: 'உறவு' },
  'Police division': { si: 'පොලිස් කොට්ඨාසය', ta: 'காவல் பிரிவு' },
  'Police station': { si: 'පොලිස් ස්ථානය', ta: 'காவல் நிலையம்' },
  Password: { si: 'මුරපදය', ta: 'கடவுச்சொல்' },
  'Registration number': { si: 'ලියාපදිංචි අංකය', ta: 'பதிவு எண்' },
  Code: { si: 'කේතය', ta: 'குறியீடு' },
  'Sign-in code': { si: 'පුරනය වීමේ කේතය', ta: 'உள்நுழைவுக் குறியீடு' },
  'Name of the person needing care': { si: 'රැකවරණය අවශ්‍ය පුද්ගලයාගේ නම', ta: 'பராமரிப்பு தேவைப்படுபவரின் பெயர்' },
  'Care needs': { si: 'රැකවරණ අවශ්‍යතා', ta: 'பராமரிப்புத் தேவைகள்' },
  Address: { si: 'ලිපිනය', ta: 'முகவரி' },
  Notes: { si: 'සටහන්', ta: 'குறிப்புகள்' },
  Gender: { si: 'ස්ත්‍රී පුරුෂ භාවය', ta: 'பாலினம்' },
  'Civil status': { si: 'සිවිල් තත්ත්වය', ta: 'குடிமை நிலை' },
  'District id': { si: 'දිස්ත්‍රික්ක හැඳුනුම', ta: 'மாவட்ட அடையாளம்' },
  'City id': { si: 'නගර හැඳුනුම', ta: 'நகர அடையாளம்' },
};

const ENTRIES: Triple[] = [
  // --- generic HTTP ---------------------------------------------------------
  ['Invalid credentials', 'පිවිසුම් අක්තපත්‍ර වලංගු නැත', 'உள்நுழைவுச் சான்றுகள் தவறானவை'],
  ['Internal server error', 'අභ්‍යන්තර සේවාදායක දෝෂයක්', 'உள் சேவையகப் பிழை'],
  ['Unauthorized', 'අනවසරයි', 'அங்கீகரிக்கப்படவில்லை'],
  ['Forbidden', 'තහනම්', 'தடைசெய்யப்பட்டுள்ளது'],
  ['Forbidden resource', 'මෙම සම්පතට ප්‍රවේශය තහනම්', 'இந்த வளத்தை அணுக அனுமதி இல்லை'],
  ['Not Found', 'හමු නොවීය', 'கிடைக்கவில்லை'],
  ['ThrottlerException: Too Many Requests', 'ඉල්ලීම් ඕනෑවට වඩා යවා ඇත. කරුණාකර මද වේලාවකින් නැවත උත්සාහ කරන්න.', 'அதிகமான கோரிக்கைகள். சிறிது நேரம் கழித்து மீண்டும் முயலவும்.'],
  ['You do not have permission to perform this action', 'මෙම ක්‍රියාව සිදු කිරීමට ඔබට අවසරයක් නැත', 'இந்தச் செயலைச் செய்ய உங்களுக்கு அனுமதி இல்லை'],
  ['You can only access your own caregiver record', 'ඔබට ප්‍රවේශ විය හැක්කේ ඔබේම රැකවරණ සේවක වාර්තාවට පමණි', 'உங்கள் சொந்த பராமரிப்பாளர் பதிவை மட்டுமே அணுக முடியும்'],

  // --- accounts and sign-in -------------------------------------------------
  ['Please verify your email before logging in - check your inbox for the verification link.', 'පිවිසීමට පෙර ඔබේ විද්‍යුත් තැපෑල තහවුරු කරන්න - තහවුරු කිරීමේ සබැඳිය සඳහා ඔබේ ලිපි පෙට්ටිය බලන්න.', 'உள்நுழைவதற்கு முன் உங்கள் மின்னஞ்சலைச் சரிபார்க்கவும் - சரிபார்ப்பு இணைப்புக்காக உங்கள் இன்பாக்ஸைப் பாருங்கள்.'],
  ['An account with this email already exists', 'මෙම විද්‍යුත් ලිපිනය සහිත ගිණුමක් දැනටමත් තිබේ', 'இந்த மின்னஞ்சலுடன் ஒரு கணக்கு ஏற்கனவே உள்ளது'],
  ['A user with this email already exists', 'මෙම විද්‍යුත් ලිපිනය සහිත පරිශීලකයෙක් දැනටමත් සිටී', 'இந்த மின்னஞ்சலுடன் ஒரு பயனர் ஏற்கனவே உள்ளார்'],
  ['This verification link is invalid or has expired', 'මෙම තහවුරු කිරීමේ සබැඳිය වලංගු නැත හෝ කල් ඉකුත් වී ඇත', 'இந்தச் சரிபார்ப்பு இணைப்பு செல்லாதது அல்லது காலாவதியாகிவிட்டது'],
  ['Account not found', 'ගිණුම හමු නොවීය', 'கணக்கு கிடைக்கவில்லை'],
  ['Invalid or expired refresh token', 'නැවුම් කිරීමේ ටෝකනය වලංගු නැත හෝ කල් ඉකුත් වී ඇත', 'புதுப்பிப்பு டோக்கன் செல்லாதது அல்லது காலாவதியாகிவிட்டது'],
  ['Refresh token has been revoked or expired', 'නැවුම් කිරීමේ ටෝකනය අවලංගු කර ඇත හෝ කල් ඉකුත් වී ඇත', 'புதுப்பிப்பு டோக்கன் ரத்து செய்யப்பட்டது அல்லது காலாவதியாகிவிட்டது'],
  ['Account is disabled or no longer exists', 'ගිණුම අක්‍රිය කර ඇත හෝ තවදුරටත් නොපවතී', 'கணக்கு முடக்கப்பட்டுள்ளது அல்லது இனி இல்லை'],
  ['This account signs in with WhatsApp and has no password to change', 'මෙම ගිණුම WhatsApp මගින් පුරනය වන අතර වෙනස් කිරීමට මුරපදයක් නැත', 'இந்தக் கணக்கு WhatsApp மூலம் உள்நுழைகிறது; மாற்றுவதற்குக் கடவுச்சொல் இல்லை'],
  ['Current password is incorrect', 'වත්මන් මුරපදය වැරදියි', 'தற்போதைய கடவுச்சொல் தவறானது'],
  ['Registration successful. Please check your email to verify your account before logging in.', 'ලියාපදිංචිය සාර්ථකයි. පිවිසීමට පෙර ඔබේ ගිණුම තහවුරු කිරීමට විද්‍යුත් තැපෑල බලන්න.', 'பதிவு வெற்றிகரமானது. உள்நுழைவதற்கு முன் உங்கள் கணக்கைச் சரிபார்க்க மின்னஞ்சலைப் பாருங்கள்.'],
  ['If an account with this email exists and is not yet verified, a new verification link has been sent.', 'මෙම විද්‍යුත් ලිපිනය සහිත ගිණුමක් තිබී තවම තහවුරු කර නොමැති නම්, නව තහවුරු කිරීමේ සබැඳියක් යවා ඇත.', 'இந்த மின்னஞ்சலுடன் கணக்கு இருந்து இன்னும் சரிபார்க்கப்படவில்லை என்றால், புதிய சரிபார்ப்பு இணைப்பு அனுப்பப்பட்டுள்ளது.'],
  ['Registration successful. Sign in with Google, Microsoft or Facebook to continue.', 'ලියාපදිංචිය සාර්ථකයි. දිගටම යාමට Google, Microsoft හෝ Facebook මගින් පුරනය වන්න.', 'பதிவு வெற்றிகரமானது. தொடர Google, Microsoft அல்லது Facebook மூலம் உள்நுழையவும்.'],
  ['This sign-in link has expired. Please try again.', 'මෙම පුරනය වීමේ සබැඳිය කල් ඉකුත් වී ඇත. කරුණාකර නැවත උත්සාහ කරන්න.', 'இந்த உள்நுழைவு இணைப்பு காலாவதியாகிவிட்டது. மீண்டும் முயலவும்.'],
  ['{name} sign-in is not available right now', '{name} මගින් පුරනය වීම දැන් ලබාගත නොහැක', '{name} மூலம் உள்நுழைவு தற்போது கிடைக்கவில்லை'],
  ['Unknown sign-in provider: {name}', 'නොදන්නා පුරනය වීමේ සපයන්නා: {name}', 'தெரியாத உள்நுழைவு வழங்குநர்: {name}'],
  ['You cannot change your own admin role', 'ඔබට ඔබේම පරිපාලක භූමිකාව වෙනස් කළ නොහැක', 'உங்கள் சொந்த நிர்வாகி பங்கை மாற்ற முடியாது'],
  ['You cannot deactivate your own account', 'ඔබට ඔබේම ගිණුම අක්‍රිය කළ නොහැක', 'உங்கள் சொந்தக் கணக்கை முடக்க முடியாது'],
  ['You cannot delete your own account', 'ඔබට ඔබේම ගිණුම මකා දැමිය නොහැක', 'உங்கள் சொந்தக் கணக்கை நீக்க முடியாது'],
  ['Cannot {action} the last remaining active admin', 'ඉතිරිව ඇති අවසාන සක්‍රීය පරිපාලකයා සම්බන්ධයෙන් මෙය ({action}) කළ නොහැක', 'எஞ்சியுள்ள கடைசிச் செயலில் உள்ள நிர்வாகியை {action} செய்ய முடியாது'],

  // --- finishing an account with a registration number; staff sign-in resets ---
  ['If this registration can be finished online, we have sent a code to the phone number or email address on it.', 'මෙම ලියාපදිංචිය මාර්ගගතව සම්පූර්ණ කළ හැකි නම්, එහි ඇති දුරකථන අංකයට හෝ විද්‍යුත් ලිපිනයට අපි කේතයක් යවා ඇත.', 'இந்தப் பதிவை இணையத்தில் நிறைவு செய்ய முடியுமானால், அதிலுள்ள தொலைபேசி எண்ணுக்கு அல்லது மின்னஞ்சல் முகவரிக்கு ஒரு குறியீட்டை அனுப்பியுள்ளோம்.'],
  ['Code accepted. Sign in with Google, Microsoft or Facebook to finish setting up your account.', 'කේතය පිළිගත්තා. ඔබේ ගිණුම සකසා අවසන් කිරීමට Google, Microsoft හෝ Facebook මගින් පුරනය වන්න.', 'குறியீடு ஏற்கப்பட்டது. உங்கள் கணக்கை அமைத்து முடிக்க Google, Microsoft அல்லது Facebook மூலம் உள்நுழையவும்.'],
  ['Enter your registration number', 'ඔබේ ලියාපදිංචි අංකය ඇතුළත් කරන්න', 'உங்கள் பதிவு எண்ணை உள்ளிடவும்'],
  ['Enter the code you received', 'ඔබට ලැබුණු කේතය ඇතුළත් කරන්න', 'நீங்கள் பெற்ற குறியீட்டை உள்ளிடவும்'],
  ['Unknown sign-in provider', 'නොදන්නා පුරනය වීමේ සපයන්නෙක්', 'தெரியாத உள்நுழைவு வழங்குநர்'],
  ['Choose at least one sign-in method to reset', 'යළි සැකසීමට අවම වශයෙන් එක් පුරනය වීමේ ක්‍රමයක් තෝරන්න', 'மீட்டமைக்க குறைந்தது ஒரு உள்நுழைவு முறையைத் தேர்ந்தெடுக்கவும்'],
  ['This caregiver has not set up a sign-in yet - there is nothing to reset', 'මෙම රැකවරණ සේවකයා තවම පුරනය වීමක් සකසා නැත - යළි සැකසීමට කිසිවක් නැත', 'இந்தப் பராமரிப்பாளர் இன்னும் உள்நுழைவை அமைக்கவில்லை - மீட்டமைக்க எதுவும் இல்லை'],
  ['This caregiver can already sign in. Reset their sign-in methods first, then issue a code.', 'මෙම රැකවරණ සේවකයාට දැනටමත් පුරනය විය හැක. පළමුව ඔවුන්ගේ පුරනය වීමේ ක්‍රම යළි සකසා, පසුව කේතයක් නිකුත් කරන්න.', 'இந்தப் பராமரிப்பாளர் ஏற்கனவே உள்நுழைய முடியும். முதலில் அவர்களின் உள்நுழைவு முறைகளை மீட்டமைத்து, பின்னர் குறியீட்டை வழங்கவும்.'],
  ['Please wait a moment before issuing another code', 'තවත් කේතයක් නිකුත් කිරීමට පෙර මොහොතක් රැඳී සිටින්න', 'மற்றொரு குறியீட்டை வழங்குவதற்கு முன் சிறிது நேரம் காத்திருக்கவும்'],

  // --- WhatsApp and phone numbers ------------------------------------------
  ['WhatsApp sign-in is not available right now', 'WhatsApp මගින් පුරනය වීම දැන් ලබාගත නොහැක', 'WhatsApp உள்நுழைவு தற்போது கிடைக்கவில்லை'],
  ['Enter a valid WhatsApp number, including the country code if it is not a local number', 'වලංගු WhatsApp අංකයක් ඇතුළත් කරන්න; දේශීය අංකයක් නොවේ නම් රට කේතය ද ඇතුළත් කරන්න', 'சரியான WhatsApp எண்ணை உள்ளிடவும்; உள்ளூர் எண் இல்லையெனில் நாட்டுக் குறியீட்டையும் சேர்க்கவும்'],
  ['Enter a valid phone number, including the country code if it is not a local number', 'වලංගු දුරකථන අංකයක් ඇතුළත් කරන්න; දේශීය අංකයක් නොවේ නම් රට කේතය ද ඇතුළත් කරන්න', 'சரியான தொலைபேசி எண்ணை உள்ளிடவும்; உள்ளூர் எண் இல்லையெனில் நாட்டுக் குறியீட்டையும் சேர்க்கவும்'],
  ['Enter a valid phone number', 'වලංගු දුරකථන අංකයක් ඇතුළත් කරන්න', 'சரியான தொலைபேசி எண்ணை உள்ளிடவும்'],
  ['An account with this WhatsApp number already exists', 'මෙම WhatsApp අංකය සහිත ගිණුමක් දැනටමත් තිබේ', 'இந்த WhatsApp எண்ணுடன் ஒரு கணக்கு ஏற்கனவே உள்ளது'],
  ['An account with this phone number already exists', 'මෙම දුරකථන අංකය සහිත ගිණුමක් දැනටමත් තිබේ', 'இந்தத் தொலைபேசி எண்ணுடன் ஒரு கணக்கு ஏற்கனவே உள்ளது'],
  ['An account with this phone number already exists - sign in with WhatsApp instead', 'මෙම දුරකථන අංකය සහිත ගිණුමක් දැනටමත් තිබේ - ඒ වෙනුවට WhatsApp මගින් පුරනය වන්න', 'இந்தத் தொலைபேசி எண்ணுடன் ஒரு கணக்கு ஏற்கனவே உள்ளது - அதற்குப் பதிலாக WhatsApp மூலம் உள்நுழையவும்'],
  ['An account with this phone number already exists - sign in instead', 'මෙම දුරකථන අංකය සහිත ගිණුමක් දැනටමත් තිබේ - ඒ වෙනුවට පුරනය වන්න', 'இந்தத் தொலைபேசி எண்ணுடன் ஒரு கணக்கு ஏற்கனவே உள்ளது - அதற்குப் பதிலாக உள்நுழையவும்'],
  ['This code is invalid or has expired. Request a new one and try again.', 'මෙම කේතය වලංගු නැත හෝ කල් ඉකුත් වී ඇත. නව කේතයක් ඉල්ලා නැවත උත්සාහ කරන්න.', 'இந்தக் குறியீடு செல்லாதது அல்லது காலாவதியாகிவிட்டது. புதிய குறியீட்டைக் கோரி மீண்டும் முயலவும்.'],
  ['If this number is registered, a code has been sent to it on WhatsApp.', 'මෙම අංකය ලියාපදිංචි නම්, WhatsApp මගින් කේතයක් එයට යවා ඇත.', 'இந்த எண் பதிவு செய்யப்பட்டிருந்தால், அதற்கு WhatsApp மூலம் குறியீடு அனுப்பப்பட்டுள்ளது.'],
  ['Registration successful. Enter the code we sent to your WhatsApp to verify your number.', 'ලියාපදිංචිය සාර්ථකයි. ඔබේ අංකය තහවුරු කිරීමට අප ඔබේ WhatsApp වෙත යැවූ කේතය ඇතුළත් කරන්න.', 'பதிவு வெற்றிகரமானது. உங்கள் எண்ணைச் சரிபார்க்க WhatsApp இல் அனுப்பிய குறியீட்டை உள்ளிடவும்.'],
  ['Your account was created, but we could not send the WhatsApp code just now. Request a new code to verify your number.', 'ඔබේ ගිණුම සාදන ලදී, නමුත් WhatsApp කේතය දැන් යැවීමට නොහැකි විය. ඔබේ අංකය තහවුරු කිරීමට නව කේතයක් ඉල්ලන්න.', 'உங்கள் கணக்கு உருவாக்கப்பட்டது, ஆனால் WhatsApp குறியீட்டை இப்போது அனுப்ப முடியவில்லை. உங்கள் எண்ணைச் சரிபார்க்க புதிய குறியீட்டைக் கோரவும்.'],
  ['Please wait {seconds} seconds before requesting another code', 'තවත් කේතයක් ඉල්ලීමට පෙර තත්පර {seconds}ක් රැඳී සිටින්න', 'மற்றொரு குறியீட்டைக் கோருவதற்கு முன் {seconds} விநாடிகள் காத்திருக்கவும்'],
  ['Enter a valid WhatsApp number', 'වලංගු WhatsApp අංකයක් ඇතුළත් කරන්න', 'சரியான WhatsApp எண்ணை உள்ளிடவும்'],
  ['Enter the numeric code from WhatsApp', 'WhatsApp වෙතින් ලැබුණු ඉලක්කම් කේතය ඇතුළත් කරන්න', 'WhatsApp இல் வந்த எண் குறியீட்டை உள்ளிடவும்'],

  // --- caregivers -----------------------------------------------------------
  ['Caregiver not found', 'රැකවරණ සේවකයා හමු නොවීය', 'பராமரிப்பாளர் கிடைக்கவில்லை'],
  ['A caregiver with this NIC already exists', 'මෙම ජාතික හැඳුනුම්පත් අංකය සහිත රැකවරණ සේවකයෙක් දැනටමත් සිටී', 'இந்த தேசிய அடையாள அட்டை எண்ணுடன் ஒரு பராமரிப்பாளர் ஏற்கனவே உள்ளார்'],
  ['A caregiver with this passport number already exists', 'මෙම ගමන් බලපත්‍ර අංකය සහිත රැකවරණ සේවකයෙක් දැනටමත් සිටී', 'இந்தக் கடவுச்சீட்டு எண்ணுடன் ஒரு பராமரிப்பாளர் ஏற்கனவே உள்ளார்'],
  ['A caregiver with this phone number already exists', 'මෙම දුරකථන අංකය සහිත රැකවරණ සේවකයෙක් දැනටමත් සිටී', 'இந்தத் தொலைபேசி எண்ணுடன் ஒரு பராமரிப்பாளர் ஏற்கனவே உள்ளார்'],
  ['Your identity details are locked while your registration is being verified. Contact our staff to change them.', 'ඔබේ ලියාපදිංචිය සත්‍යාපනය කරන අතරතුර ඔබේ අනන්‍යතා තොරතුරු අගුළු දමා ඇත. ඒවා වෙනස් කිරීමට අපගේ කාර්ය මණ්ඩලය අමතන්න.', 'உங்கள் பதிவு சரிபார்க்கப்படும் வரை உங்கள் அடையாள விவரங்கள் பூட்டப்பட்டுள்ளன. அவற்றை மாற்ற எங்கள் ஊழியர்களைத் தொடர்பு கொள்ளவும்.'],
  ['Cannot transition caregiver from {from} to {to}. Allowed next states: {allowed}', 'රැකවරණ සේවකයා {from} සිට {to} වෙත මාරු කළ නොහැක. අවසර ඇති ඊළඟ තත්ත්වයන්: {allowed}', 'பராமரிப்பாளரை {from} இலிருந்து {to} நிலைக்கு மாற்ற முடியாது. அனுமதிக்கப்பட்ட அடுத்த நிலைகள்: {allowed}'],
  ['Caregivers may only submit their own registration (DRAFT to REGISTERED)', 'රැකවරණ සේවකයින්ට ඉදිරිපත් කළ හැක්කේ තමන්ගේම ලියාපදිංචිය පමණි (DRAFT සිට REGISTERED)', 'பராமரிப்பாளர்கள் தங்கள் சொந்தப் பதிவை மட்டுமே சமர்ப்பிக்கலாம் (DRAFT இலிருந்து REGISTERED)'],
  ['This language is already assigned to the caregiver', 'මෙම භාෂාව දැනටමත් රැකවරණ සේවකයාට පවරා ඇත', 'இந்த மொழி ஏற்கனவே பராமரிப்பாளருக்கு ஒதுக்கப்பட்டுள்ளது'],
  ['This skill is already assigned to the caregiver', 'මෙම කුසලතාව දැනටමත් රැකවරණ සේවකයාට පවරා ඇත', 'இந்தத் திறன் ஏற்கனவே பராமரிப்பாளருக்கு ஒதுக்கப்பட்டுள்ளது'],
  ['This location is already a preferred location for the caregiver', 'මෙම ස්ථානය දැනටමත් රැකවරණ සේවකයාගේ කැමති ස්ථානයකි', 'இந்த இடம் ஏற்கனவே பராமரிப்பாளரின் விருப்பமான இடமாகும்'],
  ['Unknown city id: {id}', 'නොදන්නා නගර හැඳුනුම: {id}', 'தெரியாத நகர அடையாளம்: {id}'],
  ['Unknown district id: {id}', 'නොදන්නා දිස්ත්‍රික්ක හැඳුනුම: {id}', 'தெரியாத மாவட்ட அடையாளம்: {id}'],
  ['City {city} belongs to district {actual}, not district {requested}', 'නගරය {city} අයත් වන්නේ දිස්ත්‍රික්කය {actual} ටය, දිස්ත්‍රික්කය {requested} ට නොවේ', 'நகரம் {city} மாவட்டம் {actual} க்கு உரியது, மாவட்டம் {requested} க்கு அல்ல'],

  // --- documents, qualifications, experience -------------------------------
  ['Unsupported file type. Only PDF, JPG, PNG and WEBP files are allowed.', 'සහාය නොදක්වන ගොනු වර්ගයකි. PDF, JPG, PNG සහ WEBP ගොනු පමණක් අවසරයි.', 'ஆதரிக்கப்படாத கோப்பு வகை. PDF, JPG, PNG மற்றும் WEBP கோப்புகள் மட்டுமே அனுமதிக்கப்படும்.'],
  ['File exceeds the maximum allowed size of {bytes} bytes.', 'ගොනුව අවසර ඇති උපරිම ප්‍රමාණය වන බයිට් {bytes} ඉක්මවා ඇත.', 'கோப்பு அனுமதிக்கப்பட்ட அதிகபட்ச அளவான {bytes} பைட்டுகளைத் தாண்டியுள்ளது.'],
  ['The file content does not match its type. Upload a real PDF, JPG, PNG or WEBP file.', 'ගොනුවේ අන්තර්ගතය එහි වර්ගයට නොගැළපේ. සැබෑ PDF, JPG, PNG හෝ WEBP ගොනුවක් උඩුගත කරන්න.', 'கோப்பின் உள்ளடக்கம் அதன் வகையுடன் பொருந்தவில்லை. உண்மையான PDF, JPG, PNG அல்லது WEBP கோப்பைப் பதிவேற்றவும்.'],
  ['Choose a file to upload.', 'උඩුගත කිරීමට ගොනුවක් තෝරන්න.', 'பதிவேற்ற ஒரு கோப்பைத் தேர்ந்தெடுக்கவும்.'],
  ['You can keep at most {n} documents. Remove one first.', 'ඔබට තබා ගත හැක්කේ උපරිම ලේඛන {n}ක් පමණි. මුලින් එකක් ඉවත් කරන්න.', 'நீங்கள் அதிகபட்சம் {n} ஆவணங்களை மட்டுமே வைத்திருக்கலாம். முதலில் ஒன்றை நீக்கவும்.'],
  ['Document not found', 'ලේඛනය හමු නොවීය', 'ஆவணம் கிடைக்கவில்லை'],
  ['Document file not found on disk', 'ලේඛන ගොනුව ගබඩාවේ හමු නොවීය', 'ஆவணக் கோப்பு சேமிப்பகத்தில் கிடைக்கவில்லை'],
  ['This document is being verified or has been verified, so only staff can remove it.', 'මෙම ලේඛනය සත්‍යාපනය කරමින් පවතී හෝ සත්‍යාපනය කර ඇත, එබැවින් එය ඉවත් කළ හැක්කේ කාර්ය මණ්ඩලයට පමණි.', 'இந்த ஆவணம் சரிபார்க்கப்படுகிறது அல்லது சரிபார்க்கப்பட்டுவிட்டது, எனவே ஊழியர்கள் மட்டுமே அதை நீக்க முடியும்.'],
  ['This entry is being verified or has been verified, so only staff can remove it.', 'මෙම ඇතුළත් කිරීම සත්‍යාපනය කරමින් පවතී හෝ සත්‍යාපනය කර ඇත, එබැවින් එය ඉවත් කළ හැක්කේ කාර්ය මණ්ඩලයට පමණි.', 'இந்த உள்ளீடு சரிபார்க்கப்படுகிறது அல்லது சரிபார்க்கப்பட்டுவிட்டது, எனவே ஊழியர்கள் மட்டுமே அதை நீக்க முடியும்.'],
  ['Experience record not found', 'පළපුරුදු වාර්තාව හමු නොවීය', 'அனுபவப் பதிவு கிடைக்கவில்லை'],
  ['Qualification not found', 'සුදුසුකම හමු නොවීය', 'தகுதி கிடைக்கவில்லை'],
  ['Reference not found', 'යොමුව හමු නොවීය', 'பரிந்துரை கிடைக்கவில்லை'],
  ['Verification record not found', 'සත්‍යාපන වාර්තාව හමු නොවීය', 'சரிபார்ப்புப் பதிவு கிடைக்கவில்லை'],
  ['Language already exists', 'භාෂාව දැනටමත් තිබේ', 'மொழி ஏற்கனவே உள்ளது'],
  ['Skill already exists', 'කුසලතාව දැනටමත් තිබේ', 'திறன் ஏற்கனவே உள்ளது'],
  ['User not found', 'පරිශීලකයා හමු නොවීය', 'பயனர் கிடைக்கவில்லை'],

  // --- clients (patients/guardians) ----------------------------------------
  ['Client not found', 'සේවාලාභියා හමු නොවීය', 'வாடிக்கையாளர் கிடைக்கவில்லை'],
  ['Cannot change status from {from} to {to}. Allowed: {allowed}', 'තත්ත්වය {from} සිට {to} වෙත වෙනස් කළ නොහැක. අවසර ඇත්තේ: {allowed}', 'நிலையை {from} இலிருந்து {to} ஆக மாற்ற முடியாது. அனுமதிக்கப்பட்டவை: {allowed}'],
  ['Email cannot be the preferred contact method for an account without an email address', 'විද්‍යුත් ලිපිනයක් නොමැති ගිණුමකට විද්‍යුත් තැපෑල කැමති සම්බන්ධතා ක්‍රමය විය නොහැක', 'மின்னஞ்சல் முகவரி இல்லாத கணக்கிற்கு மின்னஞ்சலை விருப்பமான தொடர்பு முறையாக வைக்க முடியாது'],
  ['Choose both the district and the city where care is needed', 'රැකවරණය අවශ්‍ය දිස්ත්‍රික්කය සහ නගරය යන දෙකම තෝරන්න', 'பராமரிப்பு தேவைப்படும் மாவட்டம் மற்றும் நகரம் இரண்டையும் தேர்ந்தெடுக்கவும்'],

  // --- form validation (custom messages in the DTOs) -----------------------
  ['Enter a valid email address', 'වලංගු විද්‍යුත් ලිපිනයක් ඇතුළත් කරන්න', 'சரியான மின்னஞ்சல் முகவரியை உள்ளிடவும்'],
  ['You must accept the data processing consent to register', 'ලියාපදිංචි වීමට ඔබ දත්ත සැකසුම් කැමැත්ත පිළිගත යුතුය', 'பதிவு செய்ய, தரவு செயலாக்க ஒப்புதலை நீங்கள் ஏற்க வேண்டும்'],
  ['Sign-in code is not valid', 'පුරනය වීමේ කේතය වලංගු නැත', 'உள்நுழைவுக் குறியீடு செல்லாதது'],
  ['Choose who needs care', 'රැකවරණය අවශ්‍ය කාටදැයි තෝරන්න', 'யாருக்குப் பராமரிப்பு தேவை என்பதைத் தேர்ந்தெடுக்கவும்'],
  ['Choose your relationship to the person needing care', 'රැකවරණය අවශ්‍ය පුද්ගලයා සමඟ ඔබේ සම්බන්ධතාව තෝරන්න', 'பராமரிப்பு தேவைப்படுபவருடனான உங்கள் உறவைத் தேர்ந்தெடுக்கவும்'],
  ['Enter the age of the person needing care', 'රැකවරණය අවශ්‍ය පුද්ගලයාගේ වයස ඇතුළත් කරන්න', 'பராமரிப்பு தேவைப்படுபவரின் வயதை உள்ளிடவும்'],
  ['Enter a valid age', 'වලංගු වයසක් ඇතුළත් කරන්න', 'சரியான வயதை உள்ளிடவும்'],
  ['Choose the gender of the person needing care', 'රැකවරණය අවශ්‍ය පුද්ගලයාගේ ස්ත්‍රී පුරුෂ භාවය තෝරන්න', 'பராமரிப்பு தேவைப்படுபவரின் பாலினத்தைத் தேர்ந்தெடுக்கவும்'],
  ['Enter a valid alternate phone number', 'වලංගු විකල්ප දුරකථන අංකයක් ඇතුළත් කරන්න', 'சரியான மாற்றுத் தொலைபேசி எண்ணை உள்ளிடவும்'],
  ['Choose how we should contact you', 'අප ඔබව සම්බන්ධ කරගත යුතු ආකාරය තෝරන්න', 'நாங்கள் உங்களை எவ்வாறு தொடர்பு கொள்ள வேண்டும் என்பதைத் தேர்ந்தெடுக்கவும்'],
  ['Choose a valid contact time', 'වලංගු සම්බන්ධ කරගත හැකි වේලාවක් තෝරන්න', 'சரியான தொடர்பு நேரத்தைத் தேர்ந்தெடுக்கவும்'],
  ['Choose the district where care is needed', 'රැකවරණය අවශ්‍ය දිස්ත්‍රික්කය තෝරන්න', 'பராமரிப்பு தேவைப்படும் மாவட்டத்தைத் தேர்ந்தெடுக்கவும்'],
  ['Choose the city where care is needed', 'රැකවරණය අවශ්‍ය නගරය තෝරන්න', 'பராமரிப்பு தேவைப்படும் நகரத்தைத் தேர்ந்தெடுக்கவும்'],
  ['Choose when care is needed', 'රැකවරණය අවශ්‍ය වන්නේ කවදාදැයි තෝරන්න', 'பராமரிப்பு எப்போது தேவை என்பதைத் தேர்ந்தெடுக்கவும்'],
  ['Choose when care should start', 'රැකවරණය ආරම්භ විය යුත්තේ කවදාදැයි තෝරන්න', 'பராமரிப்பு எப்போது தொடங்க வேண்டும் என்பதைத் தேர்ந்தெடுக்கவும்'],
  ['Choose a valid caregiver gender preference', 'වලංගු රැකවරණ සේවක ස්ත්‍රී පුරුෂ කැමැත්තක් තෝරන්න', 'சரியான பராமரிப்பாளர் பாலின விருப்பத்தைத் தேர்ந்தெடுக்கவும்'],
  ['Enter a valid date of birth', 'වලංගු උපන් දිනයක් ඇතුළත් කරන්න', 'சரியான பிறந்த தேதியை உள்ளிடவும்'],
  ['Height must be a number of inches', 'උස අඟල් ගණනක් විය යුතුය', 'உயரம் அங்குலங்களின் எண்ணாக இருக்க வேண்டும்'],
  ['Height must be 120 inches or fewer', 'උස අඟල් 120ක් හෝ ඊට අඩු විය යුතුය', 'உயரம் 120 அங்குலங்களுக்கு மிகாமல் இருக்க வேண்டும்'],
  ['Weight must be a whole number of kilograms', 'බර සම්පූර්ණ කිලෝග්‍රෑම් ගණනක් විය යුතුය', 'எடை முழு கிலோகிராம் எண்ணாக இருக்க வேண்டும்'],
  ['District id must be a valid district', 'දිස්ත්‍රික්ක හැඳුනුම වලංගු දිස්ත්‍රික්කයක් විය යුතුය', 'மாவட்ட அடையாளம் சரியான மாவட்டமாக இருக்க வேண்டும்'],
  ['City id must be a valid city', 'නගර හැඳුනුම වලංගු නගරයක් විය යුතුය', 'நகர அடையாளம் சரியான நகரமாக இருக்க வேண்டும்'],
  ['Phone number is too long', 'දුරකථන අංකය ඉතා දිගයි', 'தொலைபேசி எண் மிக நீளமாக உள்ளது'],
  ['Gender must be MALE, FEMALE or OTHER', 'ස්ත්‍රී පුරුෂ භාවය MALE, FEMALE හෝ OTHER විය යුතුය', 'பாலினம் MALE, FEMALE அல்லது OTHER ஆக இருக்க வேண்டும்'],

  // --- class-validator's built-in wording ------------------------------------
  ['property {p} should not exist', '{p} ගුණාංගය තිබිය යුතු නොවේ', '{p} என்ற பண்பு இருக்கக் கூடாது'],
  ['{p} should not be empty', '{p} හිස් නොවිය යුතුය', '{p} காலியாக இருக்கக் கூடாது'],
  ['{p} must be a string', '{p} පෙළක් විය යුතුය', '{p} உரையாக இருக்க வேண்டும்'],
  ['{p} must be an email', '{p} වලංගු විද්‍යුත් ලිපිනයක් විය යුතුය', '{p} சரியான மின்னஞ்சலாக இருக்க வேண்டும்'],
  ['{p} must be a number string', '{p} ඉලක්කම් පමණක් අඩංගු පෙළක් විය යුතුය', '{p} இலக்கங்கள் மட்டுமே கொண்ட உரையாக இருக்க வேண்டும்'],
  ['{p} must be a number conforming to the specified constraints', '{p} නියම කළ සීමාවන්ට අනුකූල ඉලක්කමක් විය යුතුය', '{p} குறிப்பிட்ட வரம்புகளுக்கு உட்பட்ட எண்ணாக இருக்க வேண்டும்'],
  ['{p} must be an integer number', '{p} පූර්ණ සංඛ්‍යාවක් විය යුතුය', '{p} முழு எண்ணாக இருக்க வேண்டும்'],
  ['{p} must be a boolean value', '{p} සත්‍ය හෝ අසත්‍ය අගයක් විය යුතුය', '{p} ஆம்/இல்லை மதிப்பாக இருக்க வேண்டும்'],
  ['{p} must be a valid ISO 8601 date string', '{p} වලංගු දිනයක් විය යුතුය (ISO 8601)', '{p} சரியான தேதியாக இருக்க வேண்டும் (ISO 8601)'],
  ['{p} must be one of the following values: {values}', '{p} පහත අගයන්ගෙන් එකක් විය යුතුය: {values}', '{p} பின்வரும் மதிப்புகளில் ஒன்றாக இருக்க வேண்டும்: {values}'],
  ['{p} must be longer than or equal to {n} characters', '{p} අක්ෂර {n}ක් හෝ ඊට වැඩි විය යුතුය', '{p} குறைந்தது {n} எழுத்துகள் இருக்க வேண்டும்'],
  ['{p} must be shorter than or equal to {n} characters', '{p} අක්ෂර {n}ක් හෝ ඊට අඩු විය යුතුය', '{p} அதிகபட்சம் {n} எழுத்துகள் இருக்க வேண்டும்'],
  ['{p} must not be greater than {n}', '{p} {n} ට වැඩි නොවිය යුතුය', '{p} {n} ஐ விட அதிகமாக இருக்கக் கூடாது'],
  ['{p} must not be less than {n}', '{p} {n} ට අඩු නොවිය යුතුය', '{p} {n} ஐ விடக் குறைவாக இருக்கக் கூடாது'],
  ['{p} must be a positive number', '{p} ධන සංඛ්‍යාවක් විය යුතුය', '{p} நேர்மறை எண்ணாக இருக்க வேண்டும்'],
  ['{p} must match {re} regular expression', '{p} {re} රටාවට ගැළපිය යුතුය', '{p} {re} வடிவத்துடன் பொருந்த வேண்டும்'],

  // --- the same, for fields the DTOs word themselves ({label} is translated) ---
  ['{label} must be text', '{label} පෙළක් විය යුතුය', '{label} உரையாக இருக்க வேண்டும்'],
  ['{label} must be a number', '{label} ඉලක්කමක් විය යුතුය', '{label} எண்ணாக இருக்க வேண்டும்'],
  ['{label} is required', '{label} අවශ්‍යයි', '{label} அவசியம்'],
  ['{label} must be {n} characters or fewer', '{label} අක්ෂර {n}ක් හෝ ඊට අඩු විය යුතුය', '{label} {n} எழுத்துகளுக்கு மிகாமல் இருக்க வேண்டும்'],

  // --- care requests and saved caregivers ---------------------------------
  ['Choose a caregiver to contact', 'සම්බන්ධ කර ගැනීමට රැකවරණ සේවකයෙකු තෝරන්න', 'தொடர்புகொள்ள ஒரு பராமரிப்பாளரைத் தேர்ந்தெடுக்கவும்'],
  ['Your message is too long - please keep it under 1000 characters', 'ඔබගේ පණිවිඩය දිග වැඩියි - කරුණාකර අක්ෂර 1000 ට අඩුවෙන් තබන්න', 'உங்கள் செய்தி மிக நீளமாக உள்ளது - 1000 எழுத்துகளுக்குள் வைக்கவும்'],
  ["Your account can't send requests right now. Please contact us for help.", 'ඔබගේ ගිණුමට දැන් ඉල්ලීම් යැවිය නොහැක. සහාය සඳහා කරුණාකර අප හා සම්බන්ධ වන්න.', 'உங்கள் கணக்கிலிருந்து தற்போது கோரிக்கைகளை அனுப்ப முடியாது. உதவிக்கு எங்களைத் தொடர்புகொள்ளவும்.'],
  ['You already have the most open requests allowed. Our team will be in touch - you can cancel one to send another.', 'ඔබට දැනටමත් ඉඩ දී ඇති උපරිම විවෘත ඉල්ලීම් ගණන ඇත. අපගේ කණ්ඩායම ඔබව සම්බන්ධ කර ගනු ඇත - තවත් එකක් යැවීමට එකක් අවලංගු කළ හැක.', 'அனுமதிக்கப்பட்ட அதிகபட்ச திறந்த கோரிக்கைகள் ஏற்கனவே உங்களிடம் உள்ளன. எங்கள் குழு உங்களைத் தொடர்புகொள்ளும் - இன்னொன்றை அனுப்ப ஒன்றை ரத்து செய்யலாம்.'],
  ['You already have an open request for this caregiver', 'මෙම රැකවරණ සේවකයා සඳහා ඔබට දැනටමත් විවෘත ඉල්ලීමක් ඇත', 'இந்தப் பராமரிப்பாளருக்கு ஏற்கனவே உங்களிடம் ஒரு திறந்த கோரிக்கை உள்ளது'],
  ['Request not found', 'ඉල්ලීම හමු නොවීය', 'கோரிக்கை கிடைக்கவில்லை'],
  ['This request can no longer be cancelled', 'මෙම ඉල්ලීම තවදුරටත් අවලංගු කළ නොහැක', 'இந்தக் கோரிக்கையை இனி ரத்து செய்ய முடியாது'],
  ['Your saved list is full - remove someone to save another caregiver', 'ඔබගේ සුරැකි ලැයිස්තුව පිරී ඇත - තවත් රැකවරණ සේවකයෙකු සුරැකීමට කෙනෙකු ඉවත් කරන්න', 'உங்கள் சேமித்த பட்டியல் நிரம்பியுள்ளது - இன்னொரு பராமரிப்பாளரைச் சேமிக்க ஒருவரை நீக்கவும்'],
  ['Choose a valid status', 'වලංගු තත්ත්වයක් තෝරන්න', 'சரியான நிலையைத் தேர்ந்தெடுக்கவும்'],
  ['Choose why the request is being closed', 'ඉල්ලීම වසා දමන්නේ ඇයිදැයි තෝරන්න', 'கோரிக்கை ஏன் மூடப்படுகிறது என்பதைத் தேர்ந்தெடுக்கவும்'],
  ['Write a note first', 'පළමුව සටහනක් ලියන්න', 'முதலில் ஒரு குறிப்பை எழுதுங்கள்'],
  ['This request cannot be moved to that status', 'මෙම ඉල්ලීම එම තත්ත්වයට ගෙන යා නොහැක', 'இந்தக் கோரிக்கையை அந்த நிலைக்கு மாற்ற முடியாது'],
  ['This request was just changed by someone else - reload and try again', 'මෙම ඉල්ලීම දැන් වෙනත් අයෙකු විසින් වෙනස් කරන ලදී - නැවත පූරණය කර නැවත උත්සාහ කරන්න', 'இந்தக் கோரிக்கையை இப்போதுதான் வேறொருவர் மாற்றியுள்ளார் - மீண்டும் ஏற்றி முயலவும்'],
  ['The client already has another open request for this caregiver', 'සේවාලාභියාට මෙම රැකවරණ සේවකයා සඳහා දැනටමත් වෙනත් විවෘත ඉල්ලීමක් ඇත', 'வாடிக்கையாளருக்கு இந்தப் பராமரிப்பாளருக்கு ஏற்கனவே வேறொரு திறந்த கோரிக்கை உள்ளது'],
  ['Choose a caregiver before marking the request introduced', 'ඉල්ලීම හඳුන්වා දුන් බව සලකුණු කිරීමට පෙර රැකවරණ සේවකයෙකු තෝරන්න', 'கோரிக்கையை அறிமுகப்படுத்தப்பட்டது எனக் குறிப்பதற்கு முன் ஒரு பராமரிப்பாளரைத் தேர்ந்தெடுக்கவும்'],
  ['Choose an existing client or add a new caller, not both', 'පවතින සේවාලාභියෙකු තෝරන්න හෝ නව අමතන්නෙකු එක් කරන්න, දෙකම නොවේ', 'ஏற்கனவே உள்ள வாடிக்கையாளரைத் தேர்ந்தெடுக்கவும் அல்லது புதிய அழைப்பாளரைச் சேர்க்கவும், இரண்டும் அல்ல'],
  ['A client with this phone number or email already exists - search for them instead', 'මෙම දුරකථන අංකය හෝ විද්‍යුත් ලිපිනය සහිත සේවාලාභියෙකු දැනටමත් සිටී - ඒ වෙනුවට ඔවුන් සොයන්න', 'இந்தத் தொலைபேசி எண் அல்லது மின்னஞ்சலுடன் ஒரு வாடிக்கையாளர் ஏற்கனவே உள்ளார் - அதற்குப் பதிலாக அவரைத் தேடுங்கள்'],
  ['The caregiver can only be changed while the request is open', 'රැකවරණ සේවකයා වෙනස් කළ හැක්කේ ඉල්ලීම විවෘතව ඇති විට පමණි', 'கோரிக்கை திறந்திருக்கும்போது மட்டுமே பராமரிப்பாளரை மாற்ற முடியும்'],
  ['Confirm the caller agreed to us keeping their details', 'අමතන්නා ඔවුන්ගේ විස්තර තබා ගැනීමට එකඟ වූ බව තහවුරු කරන්න', 'அழைப்பாளர் தங்கள் விவரங்களை நாங்கள் வைத்திருக்க ஒப்புக்கொண்டதை உறுதிப்படுத்தவும்'],
  ['Choose the client, or add them as a new caller', 'සේවාලාභියා තෝරන්න, නැතහොත් නව අමතන්නෙකු ලෙස එක් කරන්න', 'வாடிக்கையாளரைத் தேர்ந்தெடுக்கவும், அல்லது புதிய அழைப்பாளராகச் சேர்க்கவும்'],
  ['Choose a valid caregiver', 'වලංගු රැකවරණ සේවකයෙකු තෝරන්න', 'சரியான பராமரிப்பாளரைத் தேர்ந்தெடுக்கவும்'],
  ['Choose the language for updates', 'යාවත්කාලීන කිරීම් සඳහා භාෂාව තෝරන්න', 'புதுப்பிப்புகளுக்கான மொழியைத் தேர்ந்தெடுக்கவும்'],
  ['A booking can cover at most a year - extend it later if needed', 'එක් වෙන්කිරීමකට උපරිම වසරක් ආවරණය කළ හැක - අවශ්\u200dය නම් පසුව දීර්ඝ කරන්න', 'ஒரு முன்பதிவு அதிகபட்சம் ஒரு வருடத்தை உள்ளடக்கலாம் - தேவைப்பட்டால் பின்னர் நீட்டிக்கவும்'],
  ['A booking can run for at most three years - start a new one', 'වෙන්කිරීමක් උපරිම වසර තුනක් පැවතිය හැක - නව එකක් ආරම්භ කරන්න', 'ஒரு முன்பதிவு அதிகபட்சம் மூன்று ஆண்டுகள் நீடிக்கலாம் - புதிய ஒன்றைத் தொடங்கவும்'],
  ['A shift can only be marked done or missed once it has started', 'වාරයක් ආරම්භ වූ පසුව පමණක් එය නිම කළ හෝ මඟ හැරුණු ලෙස සලකුණු කළ හැක', 'பணிநேரம் தொடங்கிய பின்னரே அதை முடிந்தது அல்லது தவறியது எனக் குறிக்க முடியும்'],
  ['A shift must end after it starts', 'වාරයක් ආරම්භ වූ පසු අවසන් විය යුතුය', 'பணிநேரம் தொடங்கிய பின்னரே முடிய வேண்டும்'],
  ['A single shift can be at most 24 hours', 'එක් වාරයක් උපරිම පැය 24ක් විය හැක', 'ஒரு பணிநேரம் அதிகபட்சம் 24 மணிநேரமாக இருக்கலாம்'],
  ['Add at least one shift before confirming', 'තහවුරු කිරීමට පෙර අවම වශයෙන් එක් වාරයක් එක් කරන්න', 'உறுதிப்படுத்துவதற்கு முன் குறைந்தது ஒரு பணிநேரத்தைச் சேர்க்கவும்'],
  ['Booking not found', 'වෙන්කිරීම හමු නොවීය', 'முன்பதிவு கிடைக்கவில்லை'],
  ['Choose a schedule type', 'කාලසටහන් වර්ගයක් තෝරන්න', 'அட்டவணை வகையைத் தேர்ந்தெடுக்கவும்'],
  ['Choose at least one day of the week', 'සතියේ අවම වශයෙන් එක් දිනයක් තෝරන්න', 'வாரத்தின் குறைந்தது ஒரு நாளைத் தேர்ந்தெடுக்கவும்'],
  ['Choose how the rate is charged', 'ගාස්තුව අය කරන ආකාරය තෝරන්න', 'கட்டணம் எவ்வாறு வசூலிக்கப்படுகிறது என்பதைத் தேர்ந்தெடுக்கவும்'],
  ['Choose the caregiver', 'රැකවරණ සේවකයා තෝරන්න', 'பராமரிப்பாளரைத் தேர்ந்தெடுக்கவும்'],
  ['Choose the client', 'සේවාලාභියා තෝරන්න', 'வாடிக்கையாளரைத் தேர்ந்தெடுக்கவும்'],
  ['Choose the days of the week', 'සතියේ දින තෝරන්න', 'வாரத்தின் நாட்களைத் தேர்ந்தெடுக்கவும்'],
  ['Enter the agreed rate as a number', 'එකඟ වූ ගාස්තුව අංකයක් ලෙස ඇතුළත් කරන්න', 'ஒப்புக்கொண்ட கட்டணத்தை எண்ணாக உள்ளிடவும்'],
  ['Enter the end date', 'අවසාන දිනය ඇතුළත් කරන්න', 'முடிவுத் தேதியை உள்ளிடவும்'],
  ['Enter the end date and time', 'අවසාන දිනය සහ වේලාව ඇතුළත් කරන්න', 'முடிவுத் தேதி மற்றும் நேரத்தை உள்ளிடவும்'],
  ['Enter the end time as HH:MM', 'අවසාන වේලාව HH:MM ලෙස ඇතුළත් කරන්න', 'முடிவு நேரத்தை HH:MM என உள்ளிடவும்'],
  ['Enter the start date', 'ආරම්භක දිනය ඇතුළත් කරන්න', 'தொடக்கத் தேதியை உள்ளிடவும்'],
  ['Enter the start date and time', 'ආරම්භක දිනය සහ වේලාව ඇතුළත් කරන්න', 'தொடக்கத் தேதி மற்றும் நேரத்தை உள்ளிடவும்'],
  ['Enter the start time as HH:MM', 'ආරම්භක වේලාව HH:MM ලෙස ඇතුළත් කරන්න', 'தொடக்க நேரத்தை HH:MM என உள்ளிடவும்'],
  ['Enter valid start and end dates', 'වලංගු ආරම්භක සහ අවසාන දින ඇතුළත් කරන්න', 'சரியான தொடக்க மற்றும் முடிவுத் தேதிகளை உள்ளிடவும்'],
  ['Enter valid start and end times', 'වලංගු ආරම්භක සහ අවසාන වේලාවන් ඇතුළත් කරන්න', 'சரியான தொடக்க மற்றும் முடிவு நேரங்களை உள்ளிடவும்'],
  ['Only a confirmed booking can be completed', 'නිම කළ හැක්කේ තහවුරු කළ වෙන්කිරීමක් පමණි', 'உறுதிசெய்யப்பட்ட முன்பதிவை மட்டுமே முடிக்க முடியும்'],
  ['Only a draft booking can be confirmed', 'තහවුරු කළ හැක්කේ කෙටුම්පත් වෙන්කිරීමක් පමණි', 'வரைவு முன்பதிவை மட்டுமே உறுதிப்படுத்த முடியும்'],
  ['Only draft shifts can be removed - cancel a scheduled shift instead', 'ඉවත් කළ හැක්කේ කෙටුම්පත් වාර පමණි - සැලසුම් කළ වාරයක් ඒ වෙනුවට අවලංගු කරන්න', 'வரைவுப் பணிநேரங்களை மட்டுமே நீக்க முடியும் - திட்டமிடப்பட்ட பணிநேரத்தை ரத்து செய்யவும்'],
  ['Say why the booking is being cancelled', 'වෙන්කිරීම අවලංගු කරන්නේ ඇයිදැයි සඳහන් කරන්න', 'முன்பதிவு ஏன் ரத்து செய்யப்படுகிறது என்று குறிப்பிடவும்'],
  ['Shift not found', 'වාරය හමු නොවීය', 'பணிநேரம் கிடைக்கவில்லை'],
  ['The chosen days produce no shifts between those dates', 'තෝරාගත් දින එම දින අතර කිසිදු වාරයක් ඇති නොකරයි', 'தேர்ந்தெடுத்த நாட்கள் அந்தத் தேதிகளுக்கு இடையே எந்தப் பணிநேரத்தையும் உருவாக்கவில்லை'],
  ['The end date must be on or after the start date', 'අවසාන දිනය ආරම්භක දිනයේ හෝ ඉන් පසු විය යුතුය', 'முடிவுத் தேதி தொடக்கத் தேதியன்றோ அதற்குப் பின்னரோ இருக்க வேண்டும்'],
  ['The new end date must be after the current one', 'නව අවසාන දිනය වත්මන් දිනයට පසු විය යුතුය', 'புதிய முடிவுத் தேதி தற்போதையதற்குப் பின் இருக்க வேண்டும்'],
  ['The pattern can only be changed while the booking is a draft - edit individual shifts or extend it instead', 'රටාව වෙනස් කළ හැක්කේ වෙන්කිරීම කෙටුම්පතක් ලෙස ඇති විට පමණි - ඒ වෙනුවට තනි වාර සංස්කරණය කරන්න හෝ දීර්ඝ කරන්න', 'முன்பதிவு வரைவாக இருக்கும்போது மட்டுமே முறையை மாற்ற முடியும் - தனிப் பணிநேரங்களைத் திருத்தவும் அல்லது நீட்டிக்கவும்'],
  ['This booking is already closed', 'මෙම වෙන්කිරීම දැනටමත් වසා ඇත', 'இந்த முன்பதிவு ஏற்கனவே மூடப்பட்டுள்ளது'],
  ['This booking is closed and can no longer be changed', 'මෙම වෙන්කිරීම වසා ඇති අතර තවදුරටත් වෙනස් කළ නොහැක', 'இந்த முன்பதிவு மூடப்பட்டுள்ளது; இனி மாற்ற முடியாது'],
  ['This booking was just changed by someone else - reload and try again', 'මෙම වෙන්කිරීම දැන් වෙනත් අයෙකු විසින් වෙනස් කරන ලදී - නැවත පූරණය කර නැවත උත්සාහ කරන්න', 'இந்த முன்பதிவை இப்போதுதான் வேறொருவர் மாற்றியுள்ளார் - மீண்டும் ஏற்றி முயலவும்'],
  // booking edits and per-shift rates
  ['Some of the shifts this would change are already on {docs} - void or revise it first, or start the change on a later day', 'මෙයින් වෙනස් වන සමහර වාර දැනටමත් {docs} හි ඇත - පළමුව එය අවලංගු හෝ සංශෝධනය කරන්න, නැතහොත් පසු දිනයකින් වෙනස ආරම්භ කරන්න', 'இது மாற்றும் சில பணிநேரங்கள் ஏற்கனவே {docs} இல் உள்ளன - முதலில் அதை ரத்து செய்யவும் அல்லது திருத்தவும், அல்லது பிந்தைய நாளிலிருந்து மாற்றத்தைத் தொடங்கவும்'],
  ['Enter the day the change starts', 'වෙනස ආරම්භ වන දිනය ඇතුළත් කරන්න', 'மாற்றம் தொடங்கும் நாளை உள்ளிடவும்'],
  ['Choose the day the change starts', 'වෙනස ආරම්භ වන දිනය තෝරන්න', 'மாற்றம் தொடங்கும் நாளைத் தேர்ந்தெடுக்கவும்'],
  ['A change can start today at the earliest - past shifts are edited one by one', 'වෙනසක් ආරම්භ කළ හැක්කේ අද හෝ ඉන් පසුවය - පසුගිය වාර එකින් එක සංස්කරණය කරන්න', 'மாற்றம் இன்று அல்லது அதற்குப் பிறகே தொடங்கலாம் - கடந்த பணிநேரங்களை ஒவ்வொன்றாகத் திருத்தவும்'],
  ['The change must start on or after the booking starts', 'වෙනස වෙන්කිරීම ආරම්භ වන දිනයේ හෝ ඉන් පසු ආරම්භ විය යුතුය', 'மாற்றம் முன்பதிவு தொடங்கும் நாளன்றோ அதற்குப் பின்னரோ தொடங்க வேண்டும்'],
  ['The change must start on or before the last day', 'වෙනස අවසාන දිනයේ හෝ ඊට පෙර ආරම්භ විය යුතුය', 'மாற்றம் கடைசி நாளன்றோ அதற்கு முன்னரோ தொடங்க வேண்டும்'],
  ['A confirmed booking\'s first day can\'t move - change it from a later day, or cancel and rebook', 'තහවුරු කළ වෙන්කිරීමක පළමු දිනය වෙනස් කළ නොහැක - පසු දිනයක සිට වෙනස් කරන්න, නැතහොත් අවලංගු කර නැවත වෙන් කරන්න', 'உறுதிசெய்யப்பட்ட முன்பதிவின் முதல் நாளை மாற்ற முடியாது - பிந்தைய நாளிலிருந்து மாற்றவும், அல்லது ரத்து செய்து மீண்டும் முன்பதிவு செய்யவும்'],
  ['Enter a valid last day', 'වලංගු අවසාන දිනයක් ඇතුළත් කරන්න', 'சரியான கடைசி நாளை உள்ளிடவும்'],
  ['A change can cover at most a year of shifts - extend the booking later instead', 'වෙනසකට උපරිම වසරක වාර ආවරණය කළ හැක - ඒ වෙනුවට පසුව වෙන්කිරීම දීර්ඝ කරන්න', 'ஒரு மாற்றம் அதிகபட்சம் ஒரு வருடப் பணிநேரங்களை உள்ளடக்கலாம் - பதிலாக முன்பதிவைப் பின்னர் நீட்டிக்கவும்'],
  ['Choose how this shift is charged', 'මෙම වාරය අය කරන ආකාරය තෝරන්න', 'இந்தப் பணிநேரம் எவ்வாறு வசூலிக்கப்படுகிறது என்பதைத் தேர்ந்தெடுக்கவும்'],
  ['Choose how this shift is paid', 'මෙම වාරය ගෙවන ආකාරය තෝරන්න', 'இந்தப் பணிநேரம் எவ்வாறு செலுத்தப்படுகிறது என்பதைத் தேர்ந்தெடுக்கவும்'],
  ['Enter the shift rate as a number', 'වාර ගාස්තුව අංකයක් ලෙස ඇතුළත් කරන්න', 'பணிநேரக் கட்டணத்தை எண்ணாக உள்ளிடவும்'],
  ['Enter the shift pay as a number', 'වාර ගෙවීම අංකයක් ලෙස ඇතුළත් කරන්න', 'பணிநேரக் கொடுப்பனவை எண்ணாக உள்ளிடவும்'],
  ['This booking is charged by the month, so a single shift cannot have its own client rate - adjust the invoice instead', 'මෙම වෙන්කිරීම මාසිකව අය කරන නිසා එක් වාරයකට වෙනම සේවාලාභී ගාස්තුවක් තිබිය නොහැක - ඒ වෙනුවට ඉන්වොයිසිය සකසන්න', 'இந்த முன்பதிவு மாதாந்தம் வசூலிக்கப்படுவதால் ஒரு பணிநேரத்திற்குத் தனி வாடிக்கையாளர் கட்டணம் இருக்க முடியாது - பதிலாக விலைப்பட்டியலைச் சரிசெய்யவும்'],
  ['The booked caregiver is paid by the month on this booking - only a cover can be paid a rate for a single shift', 'මෙම වෙන්කිරීමේ වෙන්කළ රැකවරණ සේවකයාට මාසිකව ගෙවනු ලැබේ - එක් වාරයක් සඳහා ගාස්තුවක් ගෙවිය හැක්කේ ආදේශකයෙකුට පමණි', 'இந்த முன்பதிவில் முன்பதிவு செய்யப்பட்ட பராமரிப்பாளருக்கு மாதாந்தம் செலுத்தப்படுகிறது - மாற்றுப் பராமரிப்பாளருக்கு மட்டுமே ஒரு பணிநேரத்திற்கான கட்டணம் செலுத்த முடியும்'],
  ['This overlaps shifts the caregiver already has ({refs}) - change the times or choose another caregiver', 'මෙය රැකවරණ සේවකයාට දැනටමත් ඇති වාර සමඟ අතිච්ඡාදනය වේ ({refs}) - වේලාවන් වෙනස් කරන්න හෝ වෙනත් රැකවරණ සේවකයෙකු තෝරන්න', 'இது பராமரிப்பாளரிடம் ஏற்கனவே உள்ள பணிநேரங்களுடன் மோதுகிறது ({refs}) - நேரங்களை மாற்றவும் அல்லது வேறு பராமரிப்பாளரைத் தேர்ந்தெடுக்கவும்'],
  ['This request is no longer open - reopen it or book directly', 'මෙම ඉල්ලීම තවදුරටත් විවෘත නැත - එය නැවත විවෘත කරන්න හෝ සෘජුවම වෙන් කරන්න', 'இந்தக் கோரிக்கை இனி திறந்திருக்கவில்லை - மீண்டும் திறக்கவும் அல்லது நேரடியாக முன்பதிவு செய்யவும்'],
  ['Two of these shifts overlap for the same caregiver - change the times or the caregiver first', 'මෙම වාර දෙකක් එකම රැකවරණ සේවකයා සඳහා අතිච්ඡාදනය වේ - පළමුව වේලාවන් හෝ රැකවරණ සේවකයා වෙනස් කරන්න', 'இவற்றில் இரண்டு பணிநேரங்கள் ஒரே பராமரிப்பாளருக்கு மோதுகின்றன - முதலில் நேரங்களை அல்லது பராமரிப்பாளரை மாற்றவும்'],
  ['Draft shifts are scheduled by confirming the booking', 'කෙටුම්පත් වාර සැලසුම් කරනු ලබන්නේ වෙන්කිරීම තහවුරු කිරීමෙනි', 'வரைவுப் பணிநேரங்கள் முன்பதிவை உறுதிப்படுத்துவதன் மூலம் திட்டமிடப்படுகின்றன'],
  ['This shift cannot be moved to that status', 'මෙම වාරය එම තත්ත්වයට ගෙන යා නොහැක', 'இந்தப் பணிநேரத்தை அந்த நிலைக்கு மாற்ற முடியாது'],
  ['Requests can only be assigned to an active staff member', 'ඉල්ලීම් පැවරිය හැක්කේ සක්‍රිය කාර්ය මණ්ඩල සාමාජිකයෙකුට පමණි', 'கோரிக்கைகளைச் செயலில் உள்ள பணியாளருக்கு மட்டுமே ஒதுக்க முடியும்'],
  // --- billing: invoices, payments, payouts -----------------------------------
  ['Invoice not found', 'ඉන්වොයිසිය හමු නොවීය', 'விலைப்பட்டியல் கிடைக்கவில்லை'],
  ['Payment not found', 'ගෙවීම හමු නොවීය', 'கட்டணம் கிடைக்கவில்லை'],
  ['Payout statement not found', 'ගෙවීම් ප්‍රකාශය හමු නොවීය', 'கொடுப்பனவு அறிக்கை கிடைக்கவில்லை'],
  ['Choose a valid booking', 'වලංගු වෙන්කිරීමක් තෝරන්න', 'சரியான முன்பதிவைத் தேர்ந்தெடுக்கவும்'],
  ['Choose what to bill', 'බිල්පත් කළ යුත්තේ කුමක්දැයි තෝරන්න', 'எதற்குக் கட்டணம் விதிப்பது என்று தேர்ந்தெடுக்கவும்'],
  ['Choose the language for the invoice', 'ඉන්වොයිසියේ භාෂාව තෝරන්න', 'விலைப்பட்டியலின் மொழியைத் தேர்ந்தெடுக்கவும்'],
  ['Choose what kind of line this is', 'මෙය කුමන වර්ගයේ පේළියක්දැයි තෝරන්න', 'இது எந்த வகை வரிசை என்று தேர்ந்தெடுக்கவும்'],
  ['Choose a unit', 'ඒකකයක් තෝරන්න', 'ஒரு அலகைத் தேர்ந்தெடுக்கவும்'],
  ['Choose a percentage or an amount', 'ප්‍රතිශතයක් හෝ මුදලක් තෝරන්න', 'சதவீதம் அல்லது தொகையைத் தேர்ந்தெடுக்கவும்'],
  ['Choose how it was paid', 'ගෙවූ ආකාරය තෝරන්න', 'எவ்வாறு செலுத்தப்பட்டது என்று தேர்ந்தெடுக்கவும்'],
  ['Choose how the caregiver is paid', 'රැකවරණ සේවකයාට ගෙවන ආකාරය තෝරන්න', 'பராமரிப்பாளருக்கு எவ்வாறு ஊதியம் வழங்கப்படும் என்று தேர்ந்தெடுக்கவும்'],
  ['Describe every line', 'සෑම පේළියක්ම විස්තර කරන්න', 'ஒவ்வொரு வரிசையையும் விவரிக்கவும்'],
  ['Keep each line description to 300 characters or fewer', 'සෑම පේළි විස්තරයක්ම අක්ෂර 300 හෝ ඊට අඩුවෙන් තබන්න', 'ஒவ்வொரு வரிசை விளக்கத்தையும் 300 எழுத்துகள் அல்லது அதற்குக் குறைவாக வைக்கவும்'],
  ['A document can have at most 500 lines', 'ලේඛනයකට උපරිම පේළි 500ක් තිබිය හැක', 'ஒரு ஆவணத்தில் அதிகபட்சம் 500 வரிசைகள் இருக்கலாம்'],
  ['Enter the quantity as a number', 'ප්‍රමාණය අංකයක් ලෙස ඇතුළත් කරන්න', 'அளவை எண்ணாக உள்ளிடவும்'],
  ['Enter the price as a number', 'මිල අංකයක් ලෙස ඇතුළත් කරන්න', 'விலையை எண்ணாக உள்ளிடவும்'],
  ['Enter the discount as a number', 'වට්ටම අංකයක් ලෙස ඇතුළත් කරන්න', 'தள்ளுபடியை எண்ணாக உள்ளிடவும்'],
  ['Enter the amount as a number', 'මුදල අංකයක් ලෙස ඇතුළත් කරන්න', 'தொகையை எண்ணாக உள்ளிடவும்'],
  ['Enter the pay rate as a number', 'ගෙවීම් අනුපාතය අංකයක් ලෙස ඇතුළත් කරන්න', 'ஊதிய விகிதத்தை எண்ணாக உள்ளிடவும்'],
  ['Enter the date as YYYY-MM-DD', 'දිනය YYYY-MM-DD ලෙස ඇතුළත් කරන්න', 'தேதியை YYYY-MM-DD என உள்ளிடவும்'],
  ['Enter the first day of the period', 'කාල සීමාවේ පළමු දිනය ඇතුළත් කරන්න', 'காலத்தின் முதல் நாளை உள்ளிடவும்'],
  ['Enter the last day of the period', 'කාල සීමාවේ අවසාන දිනය ඇතුළත් කරන්න', 'காலத்தின் கடைசி நாளை உள்ளிடவும்'],
  ['Enter the issue date', 'නිකුත් කරන දිනය ඇතුළත් කරන්න', 'வெளியீட்டுத் தேதியை உள்ளிடவும்'],
  ['Enter the due date', 'ගෙවිය යුතු දිනය ඇතුළත් කරන්න', 'செலுத்த வேண்டிய தேதியை உள்ளிடவும்'],
  ['Enter the date it was paid', 'ගෙවූ දිනය ඇතුළත් කරන්න', 'செலுத்தப்பட்ட தேதியை உள்ளிடவும்'],
  ['Enter who the invoice is addressed to', 'ඉන්වොයිසිය යොමු කරන්නේ කාටදැයි ඇතුළත් කරන්න', 'விலைப்பட்டியல் யாருக்கு என்பதை உள்ளிடவும்'],
  ['Enter an email address for your payment receipt', 'ඔබගේ ගෙවීම් රිසිට්පත සඳහා විද්‍යුත් තැපැල් ලිපිනයක් ඇතුළත් කරන්න', 'உங்கள் கட்டண ரசீதுக்கு ஒரு மின்னஞ்சல் முகவரியை உள்ளிடவும்'],
  ['Give a reason', 'හේතුවක් සඳහන් කරන්න', 'ஒரு காரணத்தைக் குறிப்பிடவும்'],
  ['A discount cannot be more than 100%', 'වට්ටමක් 100% ට වඩා වැඩි විය නොහැක', 'தள்ளுபடி 100% ஐ விட அதிகமாக இருக்க முடியாது'],
  ['The quantity must be more than zero', 'ප්‍රමාණය බිංදුවට වඩා වැඩි විය යුතුය', 'அளவு பூஜ்ஜியத்தை விட அதிகமாக இருக்க வேண்டும்'],
  ['The amount must be more than zero', 'මුදල බිංදුවට වඩා වැඩි විය යුතුය', 'தொகை பூஜ்ஜியத்தை விட அதிகமாக இருக்க வேண்டும்'],
  ['Only an adjustment can have a negative price', 'සෘණ මිලක් තිබිය හැක්කේ ගැලපීමකට පමණි', 'சரிசெய்தலுக்கு மட்டுமே எதிர்மறை விலை இருக்க முடியும்'],
  ['Lines for shifts are added from the shifts themselves', 'වාර සඳහා පේළි එක් කරනු ලබන්නේ වාරවලින්මය', 'பணிநேர வரிசைகள் பணிநேரங்களிலிருந்தே சேர்க்கப்படுகின்றன'],
  ['This line is not part of the document', 'මෙම පේළිය ලේඛනයේ කොටසක් නොවේ', 'இந்த வரிசை ஆவணத்தின் பகுதி அல்ல'],
  ['One invoice can cover at most a year', 'එක් ඉන්වොයිසියකට උපරිම වසරක් ආවරණය කළ හැක', 'ஒரு விலைப்பட்டியல் அதிகபட்சம் ஒரு வருடத்தை உள்ளடக்கலாம்'],
  ['One statement can cover at most a year', 'එක් ප්‍රකාශයකට උපරිම වසරක් ආවරණය කළ හැක', 'ஒரு அறிக்கை அதிகபட்சம் ஒரு வருடத்தை உள்ளடக்கலாம்'],
  ['Confirm the booking before billing it', 'බිල්පත් කිරීමට පෙර වෙන්කිරීම තහවුරු කරන්න', 'கட்டணம் விதிப்பதற்கு முன் முன்பதிவை உறுதிப்படுத்தவும்'],
  ['This invoice is not billed from shifts - add lines by hand', 'මෙම ඉන්වොයිසිය වාරවලින් බිල්පත් නොකෙරේ - පේළි අතින් එක් කරන්න', 'இந்த விலைப்பட்டியல் பணிநேரங்களிலிருந்து உருவாக்கப்படவில்லை - வரிசைகளைக் கைமுறையாகச் சேர்க்கவும்'],
  ['Only a draft invoice can be changed - void it and make a corrected copy instead', 'වෙනස් කළ හැක්කේ කෙටුම්පත් ඉන්වොයිසියක් පමණි - ඒ වෙනුවට එය අවලංගු කර නිවැරදි කළ පිටපතක් සාදන්න', 'வரைவு விலைப்பட்டியலை மட்டுமே மாற்ற முடியும் - அதற்குப் பதிலாக அதைச் செல்லாததாக்கி திருத்திய நகலை உருவாக்கவும்'],
  ['Turn tax on in Settings > Billing first', 'පළමුව සැකසුම් > බිල්පත් තුළ බද්ද සක්‍රිය කරන්න', 'முதலில் அமைப்புகள் > கட்டணம் பகுதியில் வரியை இயக்கவும்'],
  ['Add at least one line before issuing', 'නිකුත් කිරීමට පෙර අවම වශයෙන් එක් පේළියක් එක් කරන්න', 'வெளியிடுவதற்கு முன் குறைந்தது ஒரு வரிசையைச் சேர்க்கவும்'],
  ['An invoice cannot total less than zero - carry the credit to the next invoice instead', 'ඉන්වොයිසියක එකතුව බිංදුවට වඩා අඩු විය නොහැක - ඒ වෙනුවට බැර මුදල ඊළඟ ඉන්වොයිසියට ගෙන යන්න', 'விலைப்பட்டியலின் மொத்தம் பூஜ்ஜியத்தை விடக் குறைவாக இருக்க முடியாது - வரவை அடுத்த விலைப்பட்டியலுக்குக் கொண்டு செல்லவும்'],
  ['The due date must be on or after the issue date', 'ගෙවිය යුතු දිනය නිකුත් කළ දිනයේ හෝ ඉන් පසුව විය යුතුය', 'செலுத்த வேண்டிய தேதி வெளியீட்டுத் தேதியன்று அல்லது அதற்குப் பின் இருக்க வேண்டும்'],
  ['Only an issued invoice can be sent', 'යැවිය හැක්කේ නිකුත් කළ ඉන්වොයිසියක් පමණි', 'வெளியிடப்பட்ட விலைப்பட்டியலை மட்டுமே அனுப்ப முடியும்'],
  ['The client has no email address and WhatsApp updates are off - share the invoice another way', 'සේවාලාභියාට විද්‍යුත් තැපැල් ලිපිනයක් නැති අතර WhatsApp යාවත්කාලීන අක්‍රියයි - ඉන්වොයිසිය වෙනත් ආකාරයකින් බෙදා ගන්න', 'வாடிக்கையாளருக்கு மின்னஞ்சல் முகவரி இல்லை, WhatsApp அறிவிப்புகளும் முடக்கப்பட்டுள்ளன - விலைப்பட்டியலை வேறு வழியில் பகிரவும்'],
  ['A draft is not voided - delete it instead', 'කෙටුම්පතක් අවලංගු නොකෙරේ - ඒ වෙනුවට එය මකන්න', 'வரைவு செல்லாததாக்கப்படுவதில்லை - அதற்குப் பதிலாக அதை நீக்கவும்'],
  ['This invoice is already void', 'මෙම ඉන්වොයිසිය දැනටමත් අවලංගුයි', 'இந்த விலைப்பட்டியல் ஏற்கனவே செல்லாதது'],
  ['Refund the payments on this invoice before voiding it', 'අවලංගු කිරීමට පෙර මෙම ඉන්වොයිසියේ ගෙවීම් ආපසු ගෙවන්න', 'செல்லாததாக்குவதற்கு முன் இந்த விலைப்பட்டியலின் கட்டணங்களைத் திருப்பிச் செலுத்தவும்'],
  ['Payments are recorded against an issued invoice', 'ගෙවීම් සටහන් කරනු ලබන්නේ නිකුත් කළ ඉන්වොයිසියකටය', 'கட்டணங்கள் வெளியிடப்பட்ட விலைப்பட்டியலுக்கு எதிராகவே பதிவு செய்யப்படுகின்றன'],
  ['A payment cannot be dated in the future', 'ගෙවීමක් අනාගත දිනයකින් සටහන් කළ නොහැක', 'கட்டணத்துக்கு எதிர்காலத் தேதி இட முடியாது'],
  ['That is more than the balance due', 'එය ගෙවිය යුතු ශේෂයට වඩා වැඩිය', 'அது செலுத்த வேண்டிய மீதியை விட அதிகம்'],
  ['That is more than has been paid', 'එය ගෙවා ඇති මුදලට වඩා වැඩිය', 'அது செலுத்தப்பட்ட தொகையை விட அதிகம்'],
  ['An online payment cannot be deleted - record a refund instead', 'මාර්ගගත ගෙවීමක් මැකිය නොහැක - ඒ වෙනුවට ආපසු ගෙවීමක් සටහන් කරන්න', 'இணையவழிக் கட்டணத்தை நீக்க முடியாது - அதற்குப் பதிலாகப் பணத்திருப்பத்தைப் பதிவு செய்யவும்'],
  ['This invoice has nothing left to pay', 'මෙම ඉන්වොයිසියේ ගෙවීමට කිසිවක් ඉතිරි නැත', 'இந்த விலைப்பட்டியலில் செலுத்த எதுவும் மீதமில்லை'],
  ['Online payment is not available right now - please contact us to pay', 'මාර්ගගත ගෙවීම දැනට ලබා ගත නොහැක - ගෙවීමට කරුණාකර අප අමතන්න', 'இணையவழிக் கட்டணம் தற்போது கிடைக்கவில்லை - செலுத்த எங்களைத் தொடர்புகொள்ளவும்'],
  ['Add a phone number to your account to pay online', 'මාර්ගගතව ගෙවීමට ඔබගේ ගිණුමට දුරකථන අංකයක් එක් කරන්න', 'இணையவழியில் செலுத்த உங்கள் கணக்கில் தொலைபேசி எண்ணைச் சேர்க்கவும்'],
  ['This client has issued invoices, which must be kept - deactivate the account instead', 'මෙම සේවාලාභියාට නිකුත් කළ ඉන්වොයිසි ඇති අතර ඒවා තබා ගත යුතුය - ඒ වෙනුවට ගිණුම අක්‍රිය කරන්න', 'இந்த வாடிக்கையாளருக்கு வெளியிடப்பட்ட விலைப்பட்டியல்கள் உள்ளன, அவை வைத்திருக்கப்பட வேண்டும் - அதற்குப் பதிலாகக் கணக்கை முடக்கவும்'],
  ['Only a draft statement can be changed - send it back to draft first', 'වෙනස් කළ හැක්කේ කෙටුම්පත් ප්‍රකාශයක් පමණි - පළමුව එය නැවත කෙටුම්පතට යවන්න', 'வரைவு அறிக்கையை மட்டுமே மாற்ற முடியும் - முதலில் அதை மீண்டும் வரைவாக்கவும்'],
  ['Add at least one line before approving', 'අනුමත කිරීමට පෙර අවම වශයෙන් එක් පේළියක් එක් කරන්න', 'அங்கீகரிப்பதற்கு முன் குறைந்தது ஒரு வரிசையைச் சேர்க்கவும்'],
  ['A statement cannot total less than zero - carry the deduction to the next one instead', 'ප්‍රකාශයක එකතුව බිංදුවට වඩා අඩු විය නොහැක - ඒ වෙනුවට අඩු කිරීම ඊළඟ එකට ගෙන යන්න', 'அறிக்கையின் மொத்தம் பூஜ்ஜியத்தை விடக் குறைவாக இருக்க முடியாது - கழிவை அடுத்ததற்குக் கொண்டு செல்லவும்'],
  ['Only an approved statement can go back to draft', 'නැවත කෙටුම්පතට යා හැක්කේ අනුමත කළ ප්‍රකාශයකට පමණි', 'அங்கீகரிக்கப்பட்ட அறிக்கை மட்டுமே மீண்டும் வரைவாக முடியும்'],
  ['Approve the statement before marking it paid', 'ගෙවූ බව සලකුණු කිරීමට පෙර ප්‍රකාශය අනුමත කරන්න', 'செலுத்தப்பட்டதாகக் குறிப்பதற்கு முன் அறிக்கையை அங்கீகரிக்கவும்'],
  ['A paid statement cannot be voided - add a deduction to the next one instead', 'ගෙවූ ප්‍රකාශයක් අවලංගු කළ නොහැක - ඒ වෙනුවට ඊළඟ එකට අඩු කිරීමක් එක් කරන්න', 'செலுத்தப்பட்ட அறிக்கையைச் செல்லாததாக்க முடியாது - அடுத்ததில் ஒரு கழிவைச் சேர்க்கவும்'],
  ['This statement is already void', 'මෙම ප්‍රකාශය දැනටමත් අවලංගුයි', 'இந்த அறிக்கை ஏற்கனவே செல்லாதது'],
  ['This statement is void', 'මෙම ප්‍රකාශය අවලංගුයි', 'இந்த அறிக்கை செல்லாதது'],

  // --- AI search and the staff assistant -----------------------------------
  ['AI search is not available right now - please use the search form', 'AI සෙවීම දැනට ලබා ගත නොහැක - කරුණාකර සෙවුම් පෝරමය භාවිතා කරන්න', 'AI தேடல் தற்போது கிடைக்கவில்லை - தேடல் படிவத்தைப் பயன்படுத்தவும்'],
  ['Tell us a little more about the care you need', 'ඔබට අවශ්‍ය රැකවරණය ගැන තව ටිකක් කියන්න', 'உங்களுக்குத் தேவையான பராமரிப்பு பற்றி இன்னும் சற்று கூறுங்கள்'],
  ['Please keep the description under 1000 characters', 'කරුණාකර විස්තරය අක්ෂර 1000කට අඩුවෙන් තබන්න', 'விளக்கத்தை 1000 எழுத்துகளுக்குள் வைக்கவும்'],
  ['Write a message first', 'පළමුව පණිවිඩයක් ලියන්න', 'முதலில் ஒரு செய்தியை எழுதவும்'],
  ['Please keep messages under 4000 characters', 'කරුණාකර පණිවිඩ අක්ෂර 4000කට අඩුවෙන් තබන්න', 'செய்திகளை 4000 எழுத்துகளுக்குள் வைக்கவும்'],
  ['The assistant is switched off - an admin can turn it on in Settings > AI', 'සහායකය ක්‍රියාවිරහිතයි - පරිපාලකයෙකුට එය සැකසීම් > AI තුළ සක්‍රිය කළ හැක', 'உதவியாளர் முடக்கப்பட்டுள்ளது - நிர்வாகி அதை அமைப்புகள் > AI இல் இயக்கலாம்'],
  ['Conversation not found', 'සංවාදය හමු නොවීය', 'உரையாடல் கிடைக்கவில்லை'],
  ['Action not found', 'ක්‍රියාව හමු නොවීය', 'செயல் கிடைக்கவில்லை'],
  ['This change has already been decided', 'මෙම වෙනස ගැන දැනටමත් තීරණය කර ඇත', 'இந்த மாற்றம் குறித்து ஏற்கனவே முடிவு எடுக்கப்பட்டுள்ளது'],
];

// ---------------------------------------------------------------------------

interface Compiled {
  names: string[];
  re: RegExp;
  literalLength: number;
  si: string;
  ta: string;
}

const exact = new Map<string, { si: string; ta: string }>();
const patterns: Compiled[] = [];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

for (const [en, si, ta] of ENTRIES) {
  if (!/\{\w+\}/.test(en)) {
    exact.set(en, { si, ta });
    continue;
  }
  const names: string[] = [];
  const source = en
    .split(/(\{\w+\})/)
    .map((part) => {
      const placeholder = /^\{(\w+)\}$/.exec(part);
      if (!placeholder) return escapeRegExp(part);
      names.push(placeholder[1]);
      return '(.+?)';
    })
    .join('');
  patterns.push({ names, re: new RegExp(`^${source}$`), literalLength: en.replace(/\{\w+\}/g, '').length, si, ta });
}
// The most specific template wins when two could match the same text.
patterns.sort((a, b) => b.literalLength - a.literalLength);

/** Field names the catalogue can render in another language, for the coverage test. */
export const LABEL_NAMES: readonly string[] = Object.keys(LABELS);

/** Every English source text in the catalogue, for the coverage test. */
export const CATALOGUE_TEMPLATES: readonly string[] = ENTRIES.map(([en]) => en);

export function translateMessage(message: string, lang: Language): string {
  if (lang === 'en' || typeof message !== 'string') return message;

  const hit = exact.get(message);
  if (hit) return hit[lang];

  for (const pattern of patterns) {
    const match = pattern.re.exec(message);
    if (!match) continue;
    const values: Record<string, string> = {};
    pattern.names.forEach((name, i) => {
      const captured = match[i + 1];
      // Field names read better in the caller's language, where we know them.
      values[name] = name === 'label' ? (LABELS[captured]?.[lang] ?? captured) : captured;
    });
    return pattern[lang].replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? `{${name}}`);
  }
  return message;
}

/** Translates one message or a list of them (validation errors arrive as a list). */
export function translateMessages<T extends string | string[] | unknown>(message: T, lang: Language): T {
  if (Array.isArray(message)) return message.map((m) => (typeof m === 'string' ? translateMessage(m, lang) : m)) as T;
  if (typeof message === 'string') return translateMessage(message, lang) as T;
  return message;
}
