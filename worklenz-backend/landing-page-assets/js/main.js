/* eslint-disable no-invalid-this */
/* eslint-disable prefer-const */
/* eslint-disable no-undef */

// document.onreadystatechange = function () {
//   if (document.readyState == "complete") {
//     setTimeout(() => {
//       document.querySelector("body").style.opacity = "1";
//    });
//   }
// };

// eslint-disable-next-line no-undef
$(document).ready(() => {

  $(this).scrollTop(0);

  // navigation menu - active class adding
  $(".top-nav-link").click(function () {
    $(".top-nav-link").removeClass("active");
    // eslint-disable-next-line no-invalid-this
    $(this).addClass("active");
    $("html, body").animate({
      scrollTop: $($(this).attr("href")).offset().top
    }, 500);
    return false;
  });

  $(window).scroll(() => {
    $("section").each(function () {
      if ($(window).scrollTop() >= $(this).offset().top - $(window).height() / 2) {
        let sectionId = $(this).attr("id");
        if ($(window).width() > 990) {
          $(".top-nav-link").removeClass("active");
          $(`.top-nav-link.${sectionId}`).addClass("active");
        } else {
          $(".mb-nav-link").removeClass("active");
          $(`.mb-nav-link.${sectionId}`).addClass("active");
        }
      }
    });
  });

  $("#monthly-price-tab").click(() => {

    $(".price-tag-annual").removeClass("visible");
    $(".price-tag-annual").removeClass("invisible");
    $(".price-tag-month").removeClass("visible");
    $(".price-tag-month").removeClass("invisible");

    $(".price-tag-annual").addClass("invisible");
    $(".price-tag-month").addClass("visible");

  });

  $("#annual-price-tab").click(() => {

    $(".price-tag-annual").removeClass("visible");
    $(".price-tag-annual").removeClass("invisible");
    $(".price-tag-month").removeClass("visible");
    $(".price-tag-month").removeClass("invisible");

    $(".price-tag-month").addClass("invisible");
    $(".price-tag-annual").addClass("visible");

  });



  // mobile navigation menu show/hide
  $(".navbar-toggler").on("click", () => {
    $(".mobile-menu").toggleClass("show");
    $(".bg-shadow").toggleClass("show");
  });

  $("#nav-close").on("click", () => {
    $(".mobile-menu").removeClass("show");
    $(".bg-shadow").removeClass("show");
  });

  // feature list
  $(".owl-carousel").owlCarousel({
    responsive: {
      0: {
        mouseDrag: true,
        touchDrag: true,
        pullDrag: true,
        freeDrag: false,
        items: 1,
      },
      370: {
        mouseDrag: true,
        touchDrag: true,
        pullDrag: true,
        freeDrag: false,
        items: 2,
      },
      768: {
        mouseDrag: true,
        touchDrag: true,
        pullDrag: true,
        freeDrag: false,
        items: 4,
      },
      991: {
        mouseDrag: true,
        touchDrag: true,
        pullDrag: true,
        freeDrag: false,
        items: 5,
      },
      1100: {
        mouseDrag: false,
        touchDrag: false,
        pullDrag: false,
        freeDrag: false,
        items: 5,
      }
    },
  });

  // show/hide features
  let featureButtons = $(".single-feature-button");
  let featureDetails = $(".single-feature-details");
  let featureImg = $(".feature-img");
  let animating = false;

  featureButtons.each(function (index) {
    // eslint-disable-next-line no-invalid-this
    $(this).on("click", function () {
      // eslint-disable-next-line no-invalid-this
      if ($(this).hasClass("active")) return;
      if (animating) return;
      animating = true;

      const $activeFeatureDetail = featureDetails.filter(".active");
      const $activeFeatureImg = featureImg.filter(".active");
      const $targetFeatureDetail = featureDetails.eq(index);
      const $targetFeatureImg = featureImg.eq(index);

      $activeFeatureDetail.addClass("slide-out-left");
      $activeFeatureImg.addClass("slide-out-bottom");

      setTimeout(() => {
        featureButtons.removeClass("active");
        // eslint-disable-next-line no-invalid-this
        $(this).addClass("active");
        $activeFeatureDetail.removeClass("active").addClass("d-none");
        $activeFeatureImg.removeClass("active").addClass("d-none");
        $targetFeatureDetail.removeClass("d-none").addClass("active");
        $targetFeatureImg.removeClass("d-none").addClass("active");
        $targetFeatureDetail.addClass("slide-in-left");
        $targetFeatureImg.addClass("slide-in-bottom");

        setTimeout(() => {
          $activeFeatureDetail.removeClass("slide-out-left");
          $activeFeatureImg.removeClass("slide-out-bottom");
          $targetFeatureDetail.removeClass("slide-in-left");
          $targetFeatureImg.removeClass("slide-in-bottom");
          featureDetails.not($targetFeatureDetail).addClass("d-none");
          featureImg.not($targetFeatureImg).addClass("d-none");
          animating = false;
        }, 300);
      }, 300);
    });
  });

  // footer date
  function todayDate() {
    const d = new Date();
    const n = `${d.getFullYear()}  `;
    return document.getElementById("date").innerHTML = n;
  }
  // eslint-disable-next-line no-undef, no-use-before-define
  todayDate();

});
