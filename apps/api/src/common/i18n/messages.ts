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
