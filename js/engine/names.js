// Name pools for drafted (fictional) rookies. [first names, last names, share of draft class]
export const NAME_POOLS = [
  {
    w: 0.62, country: 'USA',
    first: 'Jake,Tyler,Mason,Cole,Hunter,Logan,Carter,Wyatt,Brady,Chase,Austin,Dylan,Ethan,Colton,Blake,Jackson,Caleb,Luke,Owen,Gavin,Tanner,Trevor,Bryce,Cooper,Easton,Jaxon,Landon,Parker,Ryder,Sawyer,Grayson,Brooks,Tucker,Walker,Nolan,Griffin,Reid,Beau,Tate,Cade,Jalen,Marcus,Darius,Malik,Xavier,Isaiah,Elijah,Andre,Terrance,Devin,Jordan,Cameron,Trey,Zach,Kyle,Connor,Garrett,Drew,Max,Sam,Ben,Will,Jack,Henry,Charlie,Eli,Noah,Liam,Aiden,Josh,Ryan,Sean,Brandon,Derek,Travis,Shane,Dalton,Bryson,Kade,Maddox,Rhett,Holden,Jace,Kellen,Dax,Boone,Colt,Gunnar,Hayes,Briggs,Sterling,Dawson,Emmett,Graham,Silas,Wes,Camden,Ty,Bo,Jett,Nash,Pierce,Quinn,Roman,Zane',
    last: 'Anderson,Baker,Bennett,Brooks,Carter,Collins,Cooper,Davis,Edwards,Evans,Fisher,Foster,Graham,Hall,Harris,Hayes,Henderson,Hughes,Jenkins,Kelly,Kennedy,Lawson,Mitchell,Morgan,Murphy,Nelson,Parker,Peterson,Phillips,Reed,Richardson,Roberts,Russell,Sanders,Stewart,Sullivan,Thompson,Turner,Walker,Ward,Watson,White,Wright,Young,Abbott,Barrett,Beckett,Bishop,Blackwood,Bowman,Brennan,Callahan,Chandler,Crawford,Dalton,Donovan,Drummond,Ellison,Fairchild,Garrison,Gentry,Hadley,Hartley,Holloway,Kirkland,Langford,Maddox,Mercer,Montgomery,Nash,Prescott,Rawlings,Ridley,Sawyer,Shepard,Sterling,Tanner,Thatcher,Vaughn,Whitaker,Winslow,Yates,Jefferson,Washington,Coleman,Bryant,Gaines,Hollins,Mosley,Tolbert,Okafor,Adeyemi,Kowalski,Novak,Schmidt,Becker,Larsen,Olsen,Rossi,Marino,DeLuca,O\'Brien,McAllister,Fitzgerald,Gallagher',
  },
  {
    w: 0.27, country: 'Dominican Republic',
    first: 'José,Luis,Carlos,Juan,Miguel,Pedro,Rafael,Ángel,Víctor,Jesús,Francisco,Manuel,Diego,Andrés,Yoel,Yordan,Jhonny,Wilmer,Eloy,Ronny,Starlin,Jeison,Yeiner,Oneil,Emmanuel,Cristian,Darwin,Edwin,Félix,Gregory,Héctor,Iván,Javier,Kelvin,Leonel,Maikel,Nelson,Omar,Ramón,Santiago,Teodoro,Ulises,Wander,Yadiel,Alexis,Bryan,Esteban,Gabriel,Julio,Marcos,Noelvi,Enmanuel,Jhostynxon,Yeremi,Deyvison,Elian,Rosman,Yohendrick,Samuel,Rayner',
    last: 'Rodríguez,Martínez,García,Hernández,López,González,Pérez,Sánchez,Ramírez,Torres,Flores,Rivera,Gómez,Díaz,Reyes,Cruz,Morales,Ortiz,Gutiérrez,Chávez,Ramos,Castillo,Mendoza,Vargas,Jiménez,Rojas,Acosta,Guerrero,Medina,Peña,Santana,Núñez,De La Cruz,Polanco,Encarnación,Tejada,Marte,Soriano,Valdez,Rosario,Paredes,Cabrera,Arias,Batista,Colón,Féliz,Guzmán,Lugo,Mejía,Pimentel,Quezada,Severino,Uribe,Villar,Zapata,Almonte,Bautista,Contreras,Duran,Espinal',
  },
  {
    w: 0.07, country: 'Japan',
    first: 'Haruto,Sota,Yuto,Ren,Kaito,Riku,Daiki,Shota,Kenta,Yuki,Takumi,Ryo,Hiroto,Kazuma,Masato,Shun,Taiga,Kotaro,Sho,Itsuki,Min-jun,Ji-ho,Seung-woo,Hyun-woo,Dong-hyun,Jae-won',
    last: 'Sato,Suzuki,Takahashi,Tanaka,Watanabe,Ito,Yamamoto,Nakamura,Kobayashi,Kato,Yoshida,Yamada,Sasaki,Matsumoto,Inoue,Kimura,Hayashi,Shimizu,Mori,Ikeda,Kim,Lee,Park,Choi,Jung,Kang',
  },
  {
    w: 0.04, country: 'Canada',
    first: 'Liam,Noah,Owen,Ethan,Lucas,Nathan,Félix,Émile,Tristan,Xavier,Declan,Callum',
    last: 'Tremblay,Gagnon,Roy,Bouchard,Gauthier,Morin,Lavoie,Fortin,MacDonald,Campbell,Fraser,Sinclair,Desjardins,Pelletier',
  },
].map(p => ({ ...p, first: p.first.split(','), last: p.last.split(',') }));

export function randomName(rng) {
  const pool = rng.weighted(NAME_POOLS, p => p.w);
  return { first: rng.pick(pool.first), last: rng.pick(pool.last), country: pool.country };
}
