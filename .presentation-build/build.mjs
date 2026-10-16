import fs from 'node:fs/promises';
import {Presentation,PresentationFile} from '@oai/artifact-tool';
import {finalizePresentation} from '/Users/abulkasimovbakhtiyar/.codex/plugins/cache/openai-primary-runtime/presentations/26.1013.11914/skills/presentations/container_tools/artifact_tool_utils.mjs';
const root='/Users/abulkasimovbakhtiyar/IdeaProjects/adal-ai';
const dir=root+'/.presentation-build';
const assets=dir+'/assets';
const P=Presentation.create({slideSize:{width:1280,height:720}});
const C={bg:'#F5F5EE',ink:'#173B35',green:'#21725B',muted:'#5D7069',light:'#BBD8BE',white:'#FFFFFF',gold:'#D4B273',dark:'#102D29'};
const font='Arial';
function text(s,v,x,y,w,h,size=28,color=C.ink,bold=false){const o=s.shapes.add({geometry:'textbox',name:v.slice(0,40),position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});o.text=v;o.text.style={typeface:font,fontSize:size,color,bold,verticalAlignment:'top'};o.text.insets=0;return o;}
function base(title,sub='',dark=false){const s=P.slides.add();s.background.fill=dark?C.dark:C.bg;const n=P.slides.items.length;text(s,title,64,54,1152,100,46,dark?C.white:C.ink,true);if(sub)text(s,sub,66,145,1148,54,23,dark?C.light:C.muted);text(s,String(n).padStart(2,'0'),1180,667,40,26,16,dark?C.light:C.muted);return s;}
async function img(s,name,x,y,w,h,fit='contain'){const bytes=await fs.readFile(assets+'/'+name);return s.images.add({blob:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),contentType:name.endsWith('.png')?'image/png':'image/jpeg',alt:name,fit,position:{left:x,top:y,width:w,height:h}});}
function notes(s,speech,sources=''){s.speakerNotes.text=speech+'\n\nИсточники: '+sources;}
function row(s,num,title,body,y,x=66,w=1120){text(s,num,x,y,72,52,36,C.green,true);text(s,title,x+86,y,w-86,40,29,C.ink,true);text(s,body,x+86,y+46,w-86,70,24,C.muted);}
let s=base('');
await img(s,'almaty.jpg',656,0,624,720,'cover');
text(s,'ADAL AI',64,150,560,110,78,C.ink,true);
text(s,'ИИ-навигатор\nпо официальным\nдокументам Казахстана',68,280,550,170,38,C.ink);
text(s,'Бахтияр и Эмиль',68,555,540,42,28,C.green,true);
text(s,'Конкурс «Адал қоғам»\nАлматы, 16 октября 2026',68,610,540,66,22,C.muted);
notes(s,'15 секунд. Мы представляем Adal AI, помощника для поиска и объяснения официальной информации Казахстана. Наша главная задача: связывать каждый ответ с проверяемыми источниками.','Положение конкурса, п. 1–4. Фото: Bekarys Khozhanazar, Unsplash, https://unsplash.com/photos/a-view-of-a-city-with-mountains-in-the-background-Is8ARHv0ODw');

s=base('Официальная информация понятным языком');
text(s,'Вопрос своими словами',64,194,365,80,32,C.green,true);
text(s,'Пользователю нужно найти документ, понять формулировки и проверить источник.',64,292,350,150,28);
text(s,'Русский и казахский\nВеб-портал',64,505,355,95,27,C.muted);
await img(s,'portal-ru.jpg',435,177,785,483);
notes(s,'25 секунд. Официальная информация распределена между документами и сайтами. Adal AI принимает вопрос обычным языком и помогает найти объяснение с источниками. Здесь реальный интерфейс нашего веб-портала. Пользователь выбирает русский или казахский язык.','README.md; frontend/adal-ai/frontend/src/App.tsx; src/i18n/ru.ts; реальный скриншот http://127.0.0.1:8000/ от 16.10.2026.');

s=base('База знаний под контролем команды','Загрузка официальных материалов и проверка перед включением в поиск');
text(s,'37',64,221,240,100,88,C.green,true);
text(s,'источников\nв каталоге',68,330,300,90,30,C.ink,true);
text(s,'«Әділет» и Акорда\n\nДокумент хранит ссылку,\nредакцию и дату проверки.',68,452,340,175,25,C.muted);
await img(s,'library.jpg',427,210,805,436);
notes(s,'25 секунд. Встроенный каталог содержит 37 официальных источников. Мы загружаем документы, проверяем текст и редакцию, затем включаем материал в поиск. Интернет используется для получения материалов из каталога. Во время ответа поиск идёт по подготовленной базе. На снятом локальном экране документы ещё находятся на проверке.','backend/app/catalog.py; app/collector.py; app/library.py; app/corpus.py; реальный скриншот раздела «База знаний», 16.10.2026. 37 записей каталога, а не 37 активных документов.');

s=base('Как Adal AI находит нужный фрагмент','Поиск по ключевым словам с ранжированием BM25');
row(s,'01','Подготовка вопроса','Определение языка, нормализация текста и удаление служебных слов',219);
row(s,'02','Поиск совпадений','Основа русских слов и словарь русских и казахских выражений',351);
row(s,'03','Выбор контекста','Фильтр по языку и дате проверки, затем до 5 фрагментов для модели',483);
notes(s,'30 секунд. Сначала система обрабатывает вопрос: определяет язык, нормализует текст и выделяет значимые слова. Алгоритм BM25 ранжирует фрагменты по совпадениям. Есть обработка основы русских слов и небольшой словарь выражений на двух языках. Система исключает материалы с просроченной датой проверки и передаёт модели до пяти фрагментов.','backend/app/retrieval.py; app/config.py; app/corpus.py. Лимит контекста по умолчанию 30 000 символов. Казахского морфологического анализатора и векторного поиска в текущей реализации нет. Дата проверки не заменяет правовую экспертизу актуальности документа.');

s=base('Ответ проходит несколько проверок','Два вызова LLM в успешном цикле: генератор и критик',true);
const xs=[66,467,868];
const heads=['Генератор','Проверка цитат','Google Grounding'];
const bodies=['Создаёт ответ\nпо найденным\nфрагментам','Код сверяет цитаты,\nчисла и идентификаторы\nисточников','Проверяет опору\nкаждого утверждения\nна документы'];
for(let i=0;i<3;i++){text(s,String(i+1).padStart(2,'0'),xs[i],232,320,50,39,C.light,true);text(s,heads[i],xs[i],300,350,42,29,C.white,true);text(s,bodies[i],xs[i],361,350,125,25,C.light);}
text(s,'04  Модель-критик',66,518,490,50,32,C.white,true);
text(s,'Проверяет смысл, условия и соответствие вопросу',66,574,780,64,26,C.light);
text(s,'Показ ответа\nпосле всех этапов',903,531,300,95,27,C.gold,true);
notes(s,'40 секунд. Генератор формирует ответ по документам. Затем код проверяет цитаты и числа. Google Check Grounding оценивает, подтверждены ли утверждения источниками. После этого отдельный вызов модели-критика проверяет смысл и условия. То есть в успешном цикле есть два вызова LLM и дополнительная проверка Google. При отклонении допускается одна новая генерация с полным повтором проверок. Если подтверждения нет, текст не показывается.','backend/app/service.py; app/providers.py; app/verification.py. Критик не получает баллы Google. Одна и та же модель может выполнять обе роли. Два вызова не гарантируют независимость ошибок. При сбое внешнего сервиса возвращается temporarily_unavailable.');

s=base('Балльная проверка ответа ИИ','Порог допуска по умолчанию в текущем коде');
text(s,'0,95',64,230,520,133,108,C.green,true);
text(s,'общая оценка подтверждённости',68,382,525,85,31,C.ink,true);
text(s,'0,95',685,230,520,133,108,C.green,true);
text(s,'оценка каждого утверждения',688,382,510,85,31,C.ink,true);
text(s,'Высокий общий балл не компенсирует неподтверждённую фразу.',68,520,1120,65,30,C.ink);
text(s,'Оценка сервиса не равна вероятности правильного ответа. Пороги требуют настройки на тестовых вопросах.',68,604,1110,52,22,C.muted);
notes(s,'25 секунд. Балльная система здесь служит допуском ответа. В коде порог 0,95 задан и для всего ответа, и для каждого утверждения. Даже высокий общий балл не позволяет пропустить неподтверждённую фразу. Это оценка проверяющего сервиса, её нельзя представлять как 95 процентов точности.','backend/app/config.py: grounding_support_threshold и grounding_claim_threshold; app/verification.py. citationThreshold=0.8 используется для подбора цитат и не является тем же порогом допуска.');

s=base('Сильные стороны Adal AI');
text(s,'Проверяемые объяснения',65,203,420,45,30,C.green,true);
text(s,'Связь утверждений с цитатами\nи официальными источниками',65,259,415,92,26,C.muted);
text(s,'Безопасный отказ',65,386,420,45,30,C.green,true);
text(s,'Если доказательств недостаточно,\nсистема сообщает об этом',65,442,420,92,26,C.muted);
text(s,'Два языка и история диалога',65,561,420,90,29,C.green,true);
await img(s,'portal-kk.jpg',495,179,731,484);
notes(s,'25 секунд. Сильная сторона проекта: цепочка проверки перед показом ответа. Пользователь видит источники и может проверить важные сведения. При нехватке подтверждений бот отказывает. Русский и казахский интерфейсы уже реализованы. Историю можно удалить. Сейчас история нужна для отображения, а каждый новый вопрос ИИ обрабатывает отдельно.','frontend/adal-ai/frontend/src/i18n/kk.ts; app/web.py; app/service.py; README.md. Скриншот казахского интерфейса, 16.10.2026. Наличие механизма проверок не доказывает измеренную точность.');

s=base('Опыт и звания пользователей','Концепция следующего этапа развития');
text(s,'За что начислять опыт',66,223,540,50,34,C.green,true);
text(s,'Изучение первоисточника\n\nВерный ответ в правовом мини-тесте\n\nПрохождение учебной темы',66,301,565,245,29,C.ink);
text(s,'Лестница званий',737,223,470,50,34,C.green,true);
text(s,'Новичок\n\nИсследователь\n\nЗнаток источников',737,301,450,245,32,C.ink);
text(s,'Звание отражает учебный прогресс. Оно не даёт юридической квалификации и не влияет на проверку ответов ИИ.',66,599,1115,70,23,C.muted);
notes(s,'25 секунд. Следующий этап развития: опыт и звания пользователей. Мы предлагаем поощрять изучение документов и успешное прохождение мини-тестов. Звания показывают прогресс обучения. Они не делают человека юристом и не меняют пороги проверки ИИ. Это концепция, в текущем репозитории функция ещё не реализована.','Пожелание пользователя от 16.10.2026. Названия званий и действия для начисления опыта предложены для обсуждения. Числовые пороги, награды и антинакрутка требуют проектирования.');

s=base('Adal AI в WhatsApp','Веб-портал и привычный канал общения',true);
text(s,'+7 706 725 7286',65,251,1150,104,80,C.white,true);
text(s,'Напишите на этот номер\nи задайте вопрос Adal AI',68,392,1070,132,43,C.light);
text(s,'wa.me/77067257286',68,568,900,55,31,C.gold);
notes(s,'30 секунд. Попробовать Adal AI можно в WhatsApp по указанному номеру. Также есть веб-портал. Для демонстрации зададим вопрос о концепции «Слышащее государство», посмотрим ответ, источники и поведение при отсутствии подтверждения. Благодарим за внимание, готовы к вопросам. Основная часть слайдов занимает около 4 минут, с короткой демонстрацией до 5 минут.','Номер и возможность получить ответ в WhatsApp сообщены пользователем. WhatsApp в рамках подготовки презентации не тестировался. Адрес портала намеренно не указан по просьбе пользователя.');

s=base('Архитектура проекта','Дополнительный слайд для вопросов жюри');
row(s,'01','Веб-интерфейс','React и TypeScript: вопрос, выбор языка, ответ, источники и история',218);
row(s,'02','Сервер и данные','FastAPI, библиотека документов и JSONL-корпус. SQLite хранит историю',350);
row(s,'03','ИИ-компоненты','BM25, DeepSeek или Gemini, Google Check Grounding и модель-критик',482);
notes(s,'Резерв для вопросов. Генератор можно выбрать: Gemini или DeepSeek. Критик подключается отдельным запросом. Библиотека документов и корпус отделены от истории диалога. SQLite используется для истории, поиск документов работает по загруженному локальному корпусу. Код: https://github.com/AbulkasimovBakhtiyar2006/adal-ai','README.md; backend/app/main.py; app/library.py; app/storage.py; app/web.py; app/providers.py; frontend/adal-ai/frontend/package.json.');

s=base('Работа с сетью и повторная проверка','Дополнительный слайд для вопросов жюри');
row(s,'01','Получение материалов из интернета','Загрузка из официального каталога, просмотр текста и активация',217);
row(s,'02','Формирование ответа','Поиск по внутреннему корпусу. Произвольного веб-поиска в этом цикле нет',350);
row(s,'03','Повтор после отклонения','Одна новая генерация с кодами ошибок и повтором всех этапов',483);
notes(s,'Резерв для вопросов. Нельзя описывать текущую реализацию как автоматический поиск по всему интернету при каждом вопросе. Сеть используется при подготовке официальной базы и для вызовов AI API. Если ответ отклонён проверками, возможна ровно одна повторная генерация. При недоступности внешней проверки система возвращает сообщение о временной недоступности.','backend/app/collector.py; app/catalog.py; app/service.py; app/config.py. По умолчанию общий лимит 100 секунд, один HTTP-запрос 25 секунд, максимум 4 активных запроса.');

s=base('Готовность и ближайшие этапы','Дополнительный слайд для вопросов жюри');
const data=[['Этап','Текущее состояние / следующий шаг'],['Реализовано','Веб-интерфейс RU/KK, библиотека, BM25, цепочка проверок'],['Подготовка запуска','Проверка и активация документов, настройка внешних API'],['Проверка качества','Отдельные наборы вопросов RU/KK и экспертная оценка ответов'],['Развитие','Опыт, звания и учебные задания для пользователей']];
const tbl=s.tables.add({rows:5,columns:2,left:64,top:222,width:1152,height:353,columnWidths:[320,832],values:data});
for(let r=0;r<5;r++)for(let c=0;c<2;c++){const cell=tbl.getCell(r,c);cell.fill=r===0?C.green:r%2===0?'#E8EDE4':C.bg;cell.text.style={typeface:font,fontSize:r===0?25:24,color:r===0?C.white:C.ink,bold:r===0||c===0};}
tbl.borders.assign({fill:'#CFD8CF',width:1});
text(s,'Локальный стенд при подготовке: 37 документов загружено, 0 активно. Ключи ИИ ещё не настроены.',66,605,1130,65,22,C.muted);
notes(s,'Резерв для вопросов. Состояние локальной копии на момент подготовки: 37 документов на проверке, активных фрагментов нет, ключи генератора не заданы. Поэтому успешный живой ответ этой копии не демонстрировался. Это не оценка отдельного WhatsApp-развёртывания, о котором сообщил пользователь. Для полноценного демо нужно завершить подключение API и проверку корпуса.','Реальный локальный интерфейс /admin, 16.10.2026; README.md. План пользовательских званий сформирован по запросу пользователя.');

await fs.mkdir(dir+'/renders',{recursive:true});
for (let i=0;i<P.slides.items.length;i++){const b=await P.export({slide:P.slides.items[i],format:'png',scale:1});await fs.writeFile(dir+`/renders/slide-${String(i+1).padStart(2,'0')}.png`,new Uint8Array(await b.arrayBuffer()));}
await (await PresentationFile.exportPptx(P)).save(dir+'/draft.pptx');
await fs.writeFile(dir+'/notes.json',JSON.stringify(P.slides.items.map((s,i)=>({slide:i+1,notes:s.speakerNotes.text})),null,2));
const sk='/Users/abulkasimovbakhtiyar/.codex/plugins/cache/openai-primary-runtime/presentations/26.1013.11914/skills/presentations';
const result=await finalizePresentation({workspaceDir:root,candidatePath:dir+'/draft.pptx',finalPath:root+'/output/Adal_AI_защита.pptx',pythonExecutable:'/Users/abulkasimovbakhtiyar/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3',integrityValidatorPath:sk+'/container_tools/inspect_presentation_package_integrity.py',layoutValidatorPath:sk+'/container_tools/inspect_presentation_layout_geometry.py',layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-heading-fit','--require-native-table-slide','12'],requiredNativeTableOwnerSlides:[12],fontPolicy:{basis:'design',families:[font]},verifyArtifactToolImport:true,receiptPath:dir+'/validation.json'});
console.log(JSON.stringify(result));
